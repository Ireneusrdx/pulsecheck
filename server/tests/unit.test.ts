import { incidentTransition } from '../src/services/monitorService';
import { listDueMonitors } from '../src/repositories/monitorRepository';
import { createMonitor } from '../src/repositories/monitorRepository';
import { createUser } from '../src/repositories/userRepository';
import { query } from '../src/db';
import { uptimePercent } from '../src/services/statsService';
import { clearDb, closeDb, prepareDb } from './helpers';

describe('incident state machine (pure transitions)', () => {
  it('up + ok → stays up, no action', () => {
    expect(incidentTransition('up', true)).toEqual({ action: 'none', newStatus: 'up' });
  });

  it('up + fail → opens an incident', () => {
    expect(incidentTransition('up', false)).toEqual({ action: 'open', newStatus: 'down' });
  });

  it('unknown + fail → opens an incident', () => {
    expect(incidentTransition('unknown', false)).toEqual({ action: 'open', newStatus: 'down' });
  });

  it('unknown + ok → becomes up, no action', () => {
    expect(incidentTransition('unknown', true)).toEqual({ action: 'none', newStatus: 'up' });
  });

  it('down + fail → stays down, does NOT open a duplicate incident', () => {
    expect(incidentTransition('down', false)).toEqual({ action: 'none', newStatus: 'down' });
  });

  it('down + ok → closes the incident', () => {
    expect(incidentTransition('down', true)).toEqual({ action: 'close', newStatus: 'up' });
  });

  it('a full up→down→down→up sequence opens and closes exactly once', () => {
    const sequence = [true, false, false, false, true];
    let status: 'up' | 'down' | 'unknown' = 'unknown';
    let opens = 0;
    let closes = 0;
    for (const ok of sequence) {
      const t = incidentTransition(status, ok);
      if (t.action === 'open') opens += 1;
      if (t.action === 'close') closes += 1;
      status = t.newStatus;
    }
    expect(opens).toBe(1);
    expect(closes).toBe(1);
    expect(status).toBe('up');
  });
});

describe('uptime math', () => {
  it('is null when there are no checks', () => {
    expect(uptimePercent(0, 0)).toBeNull();
  });

  it('computes percentages rounded to two decimals', () => {
    expect(uptimePercent(4, 4)).toBe(100);
    expect(uptimePercent(4, 3)).toBe(75);
    expect(uptimePercent(3, 1)).toBe(33.33);
    expect(uptimePercent(3, 0)).toBe(0);
  });
});

describe('scheduler due-selection (against a real database)', () => {
  beforeAll(prepareDb);
  afterEach(clearDb);
  afterAll(closeDb);

  async function makeMonitor(overrides: Partial<{ interval: number; active: boolean }> = {}) {
    const user = await createUser(`due-${Math.random()}@example.com`, 'hash');
    return createMonitor(user.id, {
      name: 'due-test',
      url: 'http://127.0.0.1:9/',
      method: 'GET',
      interval_seconds: overrides.interval ?? 60,
      timeout_ms: 5000,
      expected_status_min: 200,
      expected_status_max: 399,
      webhook_url: null,
    }).then(async (m) => {
      if (overrides.active === false) {
        await query('UPDATE monitors SET is_active = FALSE WHERE id = $1', [m.id]);
      }
      return m;
    });
  }

  it('selects a monitor that has never been checked', async () => {
    const monitor = await makeMonitor();
    const due = await listDueMonitors(10);
    expect(due.map((m) => m.id)).toContain(monitor.id);
  });

  it('does not select a monitor checked within its interval', async () => {
    const monitor = await makeMonitor();
    await query('UPDATE monitors SET last_checked_at = now() WHERE id = $1', [monitor.id]);
    const due = await listDueMonitors(10);
    expect(due.map((m) => m.id)).not.toContain(monitor.id);
  });

  it('selects a monitor whose interval has elapsed', async () => {
    const monitor = await makeMonitor({ interval: 30 });
    await query(
      `UPDATE monitors SET last_checked_at = now() - interval '31 seconds' WHERE id = $1`,
      [monitor.id]
    );
    const due = await listDueMonitors(10);
    expect(due.map((m) => m.id)).toContain(monitor.id);
  });

  it('does not select inactive monitors', async () => {
    const monitor = await makeMonitor({ active: false });
    const due = await listDueMonitors(10);
    expect(due.map((m) => m.id)).not.toContain(monitor.id);
  });
});
