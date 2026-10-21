import { queryOne } from '../db';
import { MonitorRow } from '../repositories/monitorRepository';

export type StatsWindow = '24h' | '7d' | '30d';

const WINDOW_INTERVALS: Record<StatsWindow, string> = {
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export function isStatsWindow(value: string): value is StatsWindow {
  return value === '24h' || value === '7d' || value === '30d';
}

/** Uptime percentage rounded to two decimals; null when there is no data. */
export function uptimePercent(totalChecks: number, okChecks: number): number | null {
  if (totalChecks === 0) return null;
  return Math.round((okChecks / totalChecks) * 10000) / 100;
}

export interface MonitorStats {
  monitorId: number;
  window: StatsWindow;
  currentStatus: MonitorRow['current_status'];
  totalChecks: number;
  okChecks: number;
  uptimePct: number | null;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
}

interface StatsRow {
  total: string;
  ok: string;
  avg_latency: number | null;
  p95_latency: number | null;
}

export async function getMonitorStats(
  monitor: MonitorRow,
  window: StatsWindow
): Promise<MonitorStats> {
  const interval = WINDOW_INTERVALS[window];
  // percentile_cont gives the p95 latency directly in SQL.
  const row = await queryOne<StatsRow>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE ok)::text AS ok,
       AVG(latency_ms)::float AS avg_latency,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)::float AS p95_latency
     FROM checks
     WHERE monitor_id = $1 AND checked_at >= now() - $2::interval`,
    [monitor.id, interval]
  );
  const total = row ? Number(row.total) : 0;
  const ok = row ? Number(row.ok) : 0;
  return {
    monitorId: monitor.id,
    window,
    currentStatus: monitor.current_status,
    totalChecks: total,
    okChecks: ok,
    uptimePct: uptimePercent(total, ok),
    avgLatencyMs: row?.avg_latency != null ? Math.round(row.avg_latency) : null,
    p95LatencyMs: row?.p95_latency != null ? Math.round(row.p95_latency) : null,
  };
}

/** 24h uptime for every active monitor — used by the public status page. */
export interface PublicMonitorStatus {
  id: number;
  name: string;
  status: MonitorRow['current_status'];
  uptime24h: number | null;
}

export async function getPublicStatus(): Promise<PublicMonitorStatus[]> {
  const { query } = await import('../db');
  const rows = await query<{
    id: number;
    name: string;
    status: MonitorRow['current_status'];
    total: string;
    ok: string;
  }>(
    `SELECT m.id, m.name, m.current_status AS status,
            COUNT(c.id)::text AS total,
            COUNT(c.id) FILTER (WHERE c.ok)::text AS ok
       FROM monitors m
       LEFT JOIN checks c
         ON c.monitor_id = m.id AND c.checked_at >= now() - interval '24 hours'
      WHERE m.is_active = TRUE
      GROUP BY m.id, m.name, m.current_status
      ORDER BY m.name ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    uptime24h: uptimePercent(Number(r.total), Number(r.ok)),
  }));
}
