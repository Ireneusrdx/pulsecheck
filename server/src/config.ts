// Central configuration, all read from environment variables.
export const config = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ??
    'postgres://pulsecheck:pulsecheck@127.0.0.1:5432/pulsecheck',
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6379',
  cacheDriver: (process.env.CACHE_DRIVER ?? 'auto') as 'auto' | 'redis' | 'memory',
  queueDriver: (process.env.QUEUE_DRIVER ?? 'auto') as 'auto' | 'redis' | 'memory',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-change-me',
  schedulerTickMs: Number(process.env.SCHEDULER_TICK_MS ?? 5000),
  schedulerDisabled: process.env.DISABLE_SCHEDULER === 'true',
};
