// Thin fetch wrapper around the PulseCheck API. The JWT lives in
// localStorage; all /api/monitors calls attach it automatically.

export interface Monitor {
  id: number;
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
  webhook_url: string | null;
  is_active: boolean;
  last_checked_at: string | null;
  current_status: 'up' | 'down' | 'unknown';
  created_at: string;
}

export interface Check {
  id: number;
  monitor_id: number;
  checked_at: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface Incident {
  id: number;
  monitor_id: number;
  started_at: string;
  resolved_at: string | null;
  cause: string | null;
  duration_seconds: number | null;
}

export interface MonitorStats {
  monitorId: number;
  window: string;
  currentStatus: string;
  totalChecks: number;
  okChecks: number;
  uptimePct: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

export interface PublicMonitor {
  id: number;
  name: string;
  status: 'up' | 'down' | 'unknown';
  uptime24h: number | null;
}

const TOKEN_KEY = 'pulsecheck_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const token = getToken();
  if (token) headers['authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const apiGet = <T,>(path: string) => api<T>(path);
export const apiPost = <T,>(path: string, data: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(data) });
export const apiPatch = <T,>(path: string, data: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(data) });
export const apiDelete = (path: string) => api<void>(path, { method: 'DELETE' });
