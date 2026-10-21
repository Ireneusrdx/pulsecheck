import { query, queryOne } from '../db';

export interface IncidentRow {
  id: number;
  monitor_id: number;
  started_at: string;
  resolved_at: string | null;
  cause: string | null;
}

export async function findOpenIncident(monitorId: number): Promise<IncidentRow | null> {
  return queryOne<IncidentRow>(
    'SELECT * FROM incidents WHERE monitor_id = $1 AND resolved_at IS NULL',
    [monitorId]
  );
}

export async function openIncident(monitorId: number, cause: string): Promise<IncidentRow> {
  const row = await queryOne<IncidentRow>(
    'INSERT INTO incidents (monitor_id, cause) VALUES ($1, $2) RETURNING *',
    [monitorId, cause]
  );
  return row!;
}

export async function closeIncident(id: number): Promise<IncidentRow> {
  const row = await queryOne<IncidentRow>(
    'UPDATE incidents SET resolved_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  return row!;
}

export async function listIncidentsByMonitor(monitorId: number): Promise<IncidentRow[]> {
  return query<IncidentRow>(
    'SELECT * FROM incidents WHERE monitor_id = $1 ORDER BY started_at DESC',
    [monitorId]
  );
}
