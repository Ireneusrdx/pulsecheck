import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { rateLimit } from '../lib/rateLimit';
import {
  countChecksByMonitor,
  listChecksByMonitor,
} from '../repositories/checkRepository';
import { listIncidentsByMonitor } from '../repositories/incidentRepository';
import {
  createMonitor,
  deleteMonitor,
  findMonitorById,
  listMonitorsByUser,
  updateMonitor,
} from '../repositories/monitorRepository';
import { getMonitorStats, isStatsWindow, StatsWindow } from '../services/statsService';

const router = Router();
router.use(requireAuth);

const httpUrl = z
  .string()
  .url()
  .refine((u) => u.startsWith('http://') || u.startsWith('https://'), {
    message: 'URL must start with http:// or https://',
  });

const monitorFields = {
  name: z.string().min(1).max(120),
  url: httpUrl,
  method: z.enum(['GET', 'HEAD', 'POST']).default('GET'),
  interval_seconds: z.number().int().min(30).max(86400).default(60),
  timeout_ms: z.number().int().min(1000).max(30000).default(5000),
  expected_status_min: z.number().int().min(100).max(599).default(200),
  expected_status_max: z.number().int().min(100).max(599).default(399),
  webhook_url: httpUrl.nullable().optional(),
};

const createSchema = z
  .object(monitorFields)
  .refine((v) => v.expected_status_min <= v.expected_status_max, {
    message: 'expected_status_min must be <= expected_status_max',
  });

const updateSchema = z
  .object({
    name: monitorFields.name.optional(),
    url: monitorFields.url.optional(),
    method: monitorFields.method.optional(),
    interval_seconds: monitorFields.interval_seconds.optional(),
    timeout_ms: monitorFields.timeout_ms.optional(),
    expected_status_min: monitorFields.expected_status_min.optional(),
    expected_status_max: monitorFields.expected_status_max.optional(),
    webhook_url: monitorFields.webhook_url,
    is_active: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.expected_status_min === undefined ||
      v.expected_status_max === undefined ||
      v.expected_status_min <= v.expected_status_max,
    { message: 'expected_status_min must be <= expected_status_max' }
  );

const writeLimit = rateLimit('writes', 120, 15 * 60 * 1000);

/** Loads a monitor and checks ownership; sends 404 and returns null otherwise. */
async function loadOwnedMonitor(req: any, res: any) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: 'Monitor not found' });
    return null;
  }
  const monitor = await findMonitorById(id);
  if (!monitor || monitor.user_id !== req.userId) {
    res.status(404).json({ error: 'Monitor not found' });
    return null;
  }
  return monitor;
}

router.post('/', writeLimit, async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const monitor = await createMonitor(req.userId!, {
    ...parsed.data,
    webhook_url: parsed.data.webhook_url ?? null,
  });
  res.status(201).json(monitor);
});

router.get('/', async (req, res) => {
  const monitors = await listMonitorsByUser(req.userId!);
  res.json(monitors);
});

router.get('/:id', async (req, res) => {
  const monitor = await loadOwnedMonitor(req, res);
  if (monitor) res.json(monitor);
});

router.patch('/:id', writeLimit, async (req, res) => {
  const existing = await loadOwnedMonitor(req, res);
  if (!existing) return;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const updated = await updateMonitor(existing.id, req.userId!, parsed.data);
  res.json(updated);
});

router.delete('/:id', writeLimit, async (req, res) => {
  const existing = await loadOwnedMonitor(req, res);
  if (!existing) return;
  await deleteMonitor(existing.id, req.userId!);
  res.status(204).send();
});

router.get('/:id/stats', async (req, res) => {
  const monitor = await loadOwnedMonitor(req, res);
  if (!monitor) return;
  const windowParam = typeof req.query.window === 'string' ? req.query.window : '24h';
  if (!isStatsWindow(windowParam)) {
    res.status(400).json({ error: 'window must be one of 24h, 7d, 30d' });
    return;
  }
  const stats = await getMonitorStats(monitor, windowParam as StatsWindow);
  res.json(stats);
});

router.get('/:id/checks', async (req, res) => {
  const monitor = await loadOwnedMonitor(req, res);
  if (!monitor) return;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
  const [checks, total] = await Promise.all([
    listChecksByMonitor(monitor.id, limit, offset),
    countChecksByMonitor(monitor.id),
  ]);
  res.json({ checks, total, limit, offset });
});

router.get('/:id/incidents', async (req, res) => {
  const monitor = await loadOwnedMonitor(req, res);
  if (!monitor) return;
  const incidents = await listIncidentsByMonitor(monitor.id);
  res.json(
    incidents.map((i) => ({
      ...i,
      duration_seconds:
        i.resolved_at !== null
          ? Math.round((new Date(i.resolved_at).getTime() - new Date(i.started_at).getTime()) / 1000)
          : null,
    }))
  );
});

export default router;
