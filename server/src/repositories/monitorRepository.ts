import { query, queryOne } from '../db';

export type MonitorStatus = 'up' | 'down' | 'unknown';

export interface MonitorRow {
  id: number;
  user_id: number;
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
  current_status: MonitorStatus;
  created_at: string;
}

export interface MonitorInput {
  name: string;
  url: string;
  method: string;
  interval_seconds: number;
  timeout_ms: number;
  expected_status_min: number;
  expected_status_max: number;
  webhook_url: string | null;
}

export async function createMonitor(userId: number, input: MonitorInput): Promise<MonitorRow> {
  const row = await queryOne<MonitorRow>(
    `INSERT INTO monitors
       (user_id, name, url, method, interval_seconds, timeout_ms,
        expected_status_min, expected_status_max, webhook_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      userId,
      input.name,
      input.url,
      input.method,
      input.interval_seconds,
      input.timeout_ms,
      input.expected_status_min,
      input.expected_status_max,
      input.webhook_url,
    ]
  );
  return row!;
}

export async function listMonitorsByUser(userId: number): Promise<MonitorRow[]> {
  return query<MonitorRow>(
    'SELECT * FROM monitors WHERE user_id = $1 ORDER BY created_at ASC',
    [userId]
  );
}

export async function findMonitorById(id: number): Promise<MonitorRow | null> {
  return queryOne<MonitorRow>('SELECT * FROM monitors WHERE id = $1', [id]);
}

export async function updateMonitor(
  id: number,
  userId: number,
  fields: Partial<MonitorInput> & { is_active?: boolean }
): Promise<MonitorRow | null> {
  // Build the SET clause from only the fields that were provided.
  const allowed: Array<keyof typeof fields> = [
    'name',
    'url',
    'method',
    'interval_seconds',
    'timeout_ms',
    'expected_status_min',
    'expected_status_max',
    'webhook_url',
    'is_active',
  ];
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      values.push(fields[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findMonitorById(id);
  values.push(id, userId);
  return queryOne<MonitorRow>(
    `UPDATE monitors SET ${sets.join(', ')} WHERE id = $${values.length - 1} AND user_id = $${values.length} RETURNING *`,
    values
  );
}

export async function deleteMonitor(id: number, userId: number): Promise<boolean> {
  const rows = await query(
    'DELETE FROM monitors WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

/**
 * Monitors that are due for a check: active, and either never checked or
 * last checked longer ago than their interval. Ordered so the most
 * overdue monitors are picked first.
 */
export async function listDueMonitors(limit: number): Promise<MonitorRow[]> {
  return query<MonitorRow>(
    `SELECT * FROM monitors
      WHERE is_active = TRUE
        AND (last_checked_at IS NULL
             OR last_checked_at + (interval_seconds || ' seconds')::interval <= now())
      ORDER BY last_checked_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
}

export async function listAllActiveMonitors(): Promise<MonitorRow[]> {
  return query<MonitorRow>(
    'SELECT * FROM monitors WHERE is_active = TRUE ORDER BY name ASC'
  );
}

/** Records the outcome of a check on the monitor row itself. */
export async function updateMonitorAfterCheck(
  id: number,
  status: MonitorStatus
): Promise<void> {
  await query('UPDATE monitors SET last_checked_at = now(), current_status = $2 WHERE id = $1', [
    id,
    status,
  ]);
}
