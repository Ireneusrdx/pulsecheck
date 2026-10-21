import { createApp } from './app';
import { config } from './config';
import { initCache } from './lib/cache';
import { initQueue } from './lib/queue';
import { pool } from './db';
import { Scheduler } from './scheduler';

async function main(): Promise<void> {
  const cache = await initCache();
  const queue = await initQueue();
  console.log(`[pulsecheck] cache driver: ${cache.driverName}, queue driver: ${queue.driverName}`);

  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`[pulsecheck] listening on http://localhost:${config.port}`);
  });

  let scheduler: Scheduler | null = null;
  if (!config.schedulerDisabled) {
    scheduler = new Scheduler();
    await scheduler.start();
  } else {
    console.log('[pulsecheck] scheduler disabled (DISABLE_SCHEDULER=true)');
  }

  const shutdown = () => {
    scheduler?.stop();
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[pulsecheck] failed to start:', err);
  process.exit(1);
});
