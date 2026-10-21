import { FormEvent, useCallback, useEffect, useState } from 'react';
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  Check,
  getToken,
  Incident,
  Monitor,
  MonitorStats,
  PublicMonitor,
  setToken,
} from './api';

// --- tiny hash router (no dependency) -------------------------------------
function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

function navigate(to: string): void {
  window.location.hash = to;
}

// --- shared bits ------------------------------------------------------------
function StatusDot({ status }: { status: Monitor['current_status'] }) {
  return <span className={`dot ${status}`} title={status} />;
}

function formatPct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)}%`;
}

function formatMs(value: number | null): string {
  return value === null ? '—' : `${value} ms`;
}

// --- auth views ---------------------------------------------------------------
function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      const res = await apiPost<{ token: string }>(`/api/auth/${mode}`, { email, password });
      setToken(res.token);
      navigate('#/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <div className="card narrow">
      <h2>{mode === 'login' ? 'Log in' : 'Create account'}</h2>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">{mode === 'login' ? 'Log in' : 'Register'}</button>
      </form>
      <p className="muted">
        {mode === 'login' ? (
          <>No account yet? <a href="#/register">Register</a></>
        ) : (
          <>Already registered? <a href="#/login">Log in</a></>
        )}
      </p>
    </div>
  );
}

// --- dashboard ------------------------------------------------------------------
function CreateMonitorForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [interval, setIntervalSeconds] = useState(60);
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await apiPost('/api/monitors', { name, url, interval_seconds: interval });
      setName('');
      setUrl('');
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create monitor');
    }
  }

  return (
    <form className="card inline-form" onSubmit={submit}>
      <input
        placeholder="Name (e.g. Marketing site)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        required
      />
      <input
        placeholder="https://example.com"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        required
      />
      <label className="interval">
        every
        <input
          type="number"
          min={30}
          value={interval}
          onChange={(e) => setIntervalSeconds(Number(e.target.value))}
        />
        s
      </label>
      <button type="submit">Add monitor</button>
      {error && <span className="error">{error}</span>}
    </form>
  );
}

function Dashboard() {
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [stats, setStats] = useState<Record<number, MonitorStats>>({});

  const load = useCallback(async () => {
    const list = await apiGet<Monitor[]>('/api/monitors');
    setMonitors(list);
    const entries = await Promise.all(
      list.map(async (m) => {
        const s = await apiGet<MonitorStats>(`/api/monitors/${m.id}/stats?window=24h`);
        return [m.id, s] as const;
      })
    );
    setStats(Object.fromEntries(entries));
  }, []);

  useEffect(() => {
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 15000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div>
      <h2>Monitors</h2>
      <CreateMonitorForm onCreated={load} />
      {monitors.length === 0 && <p className="muted">No monitors yet — add your first one above.</p>}
      <div className="grid">
        {monitors.map((m) => (
          <div className="card monitor-card" key={m.id}>
            <div className="card-head">
              <StatusDot status={m.current_status} />
              <a href={`#/monitors/${m.id}`}>{m.name}</a>
            </div>
            <div className="muted url">{m.url}</div>
            <div className="metrics">
              <span>Uptime 24h: <strong>{formatPct(stats[m.id]?.uptimePct ?? null)}</strong></span>
              <span>Avg latency: <strong>{formatMs(stats[m.id]?.avgLatencyMs ?? null)}</strong></span>
            </div>
            <div className="muted small">
              {m.is_active ? `Checked every ${m.interval_seconds}s` : 'Paused'}
              {m.last_checked_at && ` · last check ${new Date(m.last_checked_at).toLocaleTimeString()}`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- monitor detail ---------------------------------------------------------------
function LatencyChart({ checks }: { checks: Check[] }) {
  const points = [...checks]
    .reverse()
    .filter((c) => c.latency_ms !== null)
    .map((c) => c.latency_ms as number);
  if (points.length < 2) return <p className="muted">Not enough data for a chart yet.</p>;
  const width = 640;
  const height = 140;
  const max = Math.max(...points) * 1.2;
  const stepX = width / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)},${(height - (p / max) * height).toFixed(1)}`)
    .join(' ');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="chart" role="img" aria-label="Latency history">
      <path d={path} fill="none" stroke="#4ade80" strokeWidth="2" />
    </svg>
  );
}

function MonitorDetail({ id }: { id: number }) {
  const [monitor, setMonitor] = useState<Monitor | null>(null);
  const [stats, setStats] = useState<MonitorStats | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [windowSel, setWindowSel] = useState('24h');

  const load = useCallback(async () => {
    const [m, s, c, i] = await Promise.all([
      apiGet<Monitor>(`/api/monitors/${id}`),
      apiGet<MonitorStats>(`/api/monitors/${id}/stats?window=${windowSel}`),
      apiGet<{ checks: Check[] }>(`/api/monitors/${id}/checks?limit=100`),
      apiGet<Incident[]>(`/api/monitors/${id}/incidents`),
    ]);
    setMonitor(m);
    setStats(s);
    setChecks(c.checks);
    setIncidents(i);
  }, [id, windowSel]);

  useEffect(() => {
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (!monitor) return <p className="muted">Loading…</p>;

  return (
    <div>
      <p><a href="#/">← All monitors</a></p>
      <h2>
        <StatusDot status={monitor.current_status} /> {monitor.name}
      </h2>
      <p className="muted">{monitor.url} · every {monitor.interval_seconds}s · timeout {monitor.timeout_ms}ms</p>
      <div className="actions">
        <button
          onClick={async () => {
            await apiPatch(`/api/monitors/${id}`, { is_active: !monitor.is_active });
            load();
          }}
        >
          {monitor.is_active ? 'Pause' : 'Resume'}
        </button>
        <button
          className="danger"
          onClick={async () => {
            if (confirm(`Delete monitor "${monitor.name}"?`)) {
              await apiDelete(`/api/monitors/${id}`);
              navigate('#/');
            }
          }}
        >
          Delete
        </button>
        <select value={windowSel} onChange={(e) => setWindowSel(e.target.value)}>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </div>

      <div className="grid stats-grid">
        <div className="card"><div className="stat-label">Uptime</div><div className="stat-value">{formatPct(stats?.uptimePct ?? null)}</div></div>
        <div className="card"><div className="stat-label">Checks</div><div className="stat-value">{stats?.totalChecks ?? 0}</div></div>
        <div className="card"><div className="stat-label">Avg latency</div><div className="stat-value">{formatMs(stats?.avgLatencyMs ?? null)}</div></div>
        <div className="card"><div className="stat-label">p95 latency</div><div className="stat-value">{formatMs(stats?.p95LatencyMs ?? null)}</div></div>
      </div>

      <h3>Latency history</h3>
      <div className="card"><LatencyChart checks={checks} /></div>

      <h3>Incidents</h3>
      {incidents.length === 0 && <p className="muted">No incidents recorded.</p>}
      {incidents.map((i) => (
        <div className="card incident" key={i.id}>
          <strong>{i.resolved_at ? 'Resolved' : 'Ongoing'}</strong> — {i.cause ?? 'Unknown cause'}
          <div className="muted small">
            Started {new Date(i.started_at).toLocaleString()}
            {i.resolved_at && ` · resolved ${new Date(i.resolved_at).toLocaleString()} · lasted ${i.duration_seconds}s`}
          </div>
        </div>
      ))}

      <h3>Recent checks</h3>
      <div className="card">
        <table>
          <thead><tr><th>Time</th><th>Result</th><th>Status</th><th>Latency</th><th>Error</th></tr></thead>
          <tbody>
            {checks.slice(0, 20).map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.checked_at).toLocaleTimeString()}</td>
                <td>{c.ok ? '✅ up' : '❌ down'}</td>
                <td>{c.status_code ?? '—'}</td>
                <td>{formatMs(c.latency_ms)}</td>
                <td className="muted">{c.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- public status page --------------------------------------------------------------
function StatusPage() {
  const [monitors, setMonitors] = useState<PublicMonitor[]>([]);
  const [generatedAt, setGeneratedAt] = useState('');

  useEffect(() => {
    const load = async () => {
      const res = await apiGet<{ generatedAt: string; monitors: PublicMonitor[] }>('/api/status');
      setMonitors(res.monitors);
      setGeneratedAt(res.generatedAt);
    };
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 30000);
    return () => clearInterval(timer);
  }, []);

  const allUp = monitors.length > 0 && monitors.every((m) => m.status === 'up');

  return (
    <div>
      <h2>System status</h2>
      <p className={allUp ? 'banner ok' : 'banner warn'}>
        {monitors.length === 0 ? 'No services are being monitored yet.' : allUp ? 'All systems operational' : 'Some services are experiencing issues'}
      </p>
      {monitors.map((m) => (
        <div className="card status-row" key={m.id}>
          <span><StatusDot status={m.status} /> {m.name}</span>
          <span className="muted">24h uptime: {formatPct(m.uptime24h)}</span>
        </div>
      ))}
      {generatedAt && <p className="muted small">Updated {new Date(generatedAt).toLocaleTimeString()}</p>}
    </div>
  );
}

// --- app shell -------------------------------------------------------------------------
export default function App() {
  const hash = useHashRoute();
  const loggedIn = getToken() !== null;

  let view: React.ReactNode;
  if (hash.startsWith('#/status')) {
    view = <StatusPage />;
  } else if (!loggedIn) {
    view = <AuthForm mode={hash.startsWith('#/register') ? 'register' : 'login'} />;
  } else if (hash.startsWith('#/monitors/')) {
    view = <MonitorDetail id={Number(hash.split('/')[2])} />;
  } else {
    view = <Dashboard />;
  }

  return (
    <div className="page">
      <header>
        <h1><a href="#/">📈 PulseCheck</a></h1>
        <nav>
          <a href="#/status">Public status</a>
          {loggedIn && (
            <button
              className="link"
              onClick={() => {
                setToken(null);
                navigate('#/login');
              }}
            >
              Log out
            </button>
          )}
        </nav>
      </header>
      <main>{view}</main>
    </div>
  );
}
