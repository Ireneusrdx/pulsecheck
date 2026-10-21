import { query, queryOne } from '../db';

export interface CheckRow {
  id: number;
  monitor_id: number;
  checked_at: string;
  ok: boolean;
  status_code: number | null;
  latency_ms: number | null;
  error: string | null;
}

export interface CheckResult {
  ok: boolean;
  statusCode: number | null;
  latencyMs: number | null;
  error: string | null;
}

export async function insertCheck(monitorId: number, result: CheckResult): Promise<CheckRow> {
  const row = await queryOne<CheckRow>(
    `INSERT INTO checks (monitor_id, ok, status_code, latency_ms, error)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [monitorId, result.ok, result.statusCode, result.latencyMs, result.error]
  );
  return row!;
}

export async function listChecksByMonitor(
  monitorId: number,
  limit: number,
  offset: number
): Promise<CheckRow[]> {
  return query<CheckRow>(
    `SELECT * FROM checks WHERE monitor_id = $1
      ORDER BY checked_at DESC LIMIT $2 OFFSET $3`,
    [monitorId, limit, offset]
  );
}

export async function countChecksByMonitor(monitorId: number): Promise<number> {
  const row = await queryOne<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM checks WHERE monitor_id = $1',
    [monitorId]
  );
  return row ? Number(row.count) : 0;
}
