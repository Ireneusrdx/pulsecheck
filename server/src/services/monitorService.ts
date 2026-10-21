import { getCache } from '../lib/cache';
import { CheckResult, insertCheck } from '../repositories/checkRepository';
import {
  closeIncident,
  findOpenIncident,
  IncidentRow,
  openIncident,
} from '../repositories/incidentRepository';
import {
  findMonitorById,
  MonitorRow,
  MonitorStatus,
  updateMonitorAfterCheck,
} from '../repositories/monitorRepository';
import { performCheck } from './checker';

export const PUBLIC_STATUS_CACHE_KEY = 'pulsecheck:public-status';

/**
 * The incident state machine, as a pure function:
 *
 *   current status | check ok | action        | new status
 *   ---------------+----------+---------------+-----------
 *   up / unknown   |   yes    | none          | up
 *   up / unknown   |   no     | open incident | down
 *   down           |   yes    | close incident| up
 *   down           |   no     | none          | down   (incident already open)
 */
export function incidentTransition(
  currentStatus: MonitorStatus,
  ok: boolean
): { action: 'open' | 'close' | 'none'; newStatus: MonitorStatus } {
  if (ok) {
    return { action: currentStatus === 'down' ? 'close' : 'none', newStatus: 'up' };
  }
  return { action: currentStatus === 'down' ? 'none' : 'open', newStatus: 'down' };
}

function describeFailure(result: CheckResult): string {
  if (result.error) return result.error;
  if (result.statusCode !== null) return `HTTP ${result.statusCode}`;
  return 'Check failed';
}

/** Fire-and-forget webhook notification; failures are logged, never thrown. */
export function notifyWebhook(monitor: MonitorRow, event: string, incident: IncidentRow): void {
  if (!monitor.webhook_url) return;
  fetch(monitor.webhook_url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      event,
      monitor: { id: monitor.id, name: monitor.name, url: monitor.url },
      incident: {
        id: incident.id,
        started_at: incident.started_at,
        resolved_at: incident.resolved_at,
        cause: incident.cause,
      },
    }),
  }).catch((err) => {
    console.warn(`[webhook] delivery to ${monitor.webhook_url} failed:`, err);
  });
}

/**
 * Runs one check for a monitor and records everything: the check row, the
 * monitor's current status, and any incident open/close transition.
 */
export async function runCheckForMonitor(monitorId: number): Promise<CheckResult | null> {
  const monitor = await findMonitorById(monitorId);
  if (!monitor || !monitor.is_active) return null;

  const result = await performCheck(monitor);
  await insertCheck(monitor.id, result);

  const { action, newStatus } = incidentTransition(monitor.current_status, result.ok);
  await updateMonitorAfterCheck(monitor.id, newStatus);

  if (action === 'open') {
    const incident = await openIncident(monitor.id, describeFailure(result));
    notifyWebhook(monitor, 'incident.opened', incident);
  } else if (action === 'close') {
    const open = await findOpenIncident(monitor.id);
    if (open) {
      const closed = await closeIncident(open.id);
      notifyWebhook(monitor, 'incident.resolved', closed);
    }
  }

  // The public status payload may have changed — invalidate the cache.
  await getCache().del(PUBLIC_STATUS_CACHE_KEY).catch(() => undefined);
  return result;
}
