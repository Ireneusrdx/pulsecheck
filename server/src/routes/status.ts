import { Router } from 'express';
import { getCache } from '../lib/cache';
import { PUBLIC_STATUS_CACHE_KEY } from '../services/monitorService';
import { getPublicStatus } from '../services/statsService';

const router = Router();
const TTL_SECONDS = 15;

// Public status page data — no auth. Served through the cache with a short
// TTL because status pages get polled frequently and the underlying query
// aggregates check history.
router.get('/', async (_req, res) => {
  const cache = getCache();
  const cached = await cache.get(PUBLIC_STATUS_CACHE_KEY);
  if (cached) {
    res.json(JSON.parse(cached));
    return;
  }
  const monitors = await getPublicStatus();
  const payload = { generatedAt: new Date().toISOString(), monitors };
  await cache.set(PUBLIC_STATUS_CACHE_KEY, JSON.stringify(payload), TTL_SECONDS);
  res.json(payload);
});

export default router;
