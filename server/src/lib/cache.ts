import Redis from 'ioredis';
import { config } from '../config';

// A tiny key/value cache with TTL. Two implementations share this interface:
// RedisCache (used in production) and MemoryCache (fallback so the app and
// the test-suite still work when Redis is not available).
export interface Cache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  readonly driverName: string;
}

class MemoryCache implements Cache {
  readonly driverName = 'memory';
  private store = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisCache implements Cache {
  readonly driverName = 'redis';
  constructor(private redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

let cache: Cache | null = null;

// Called once at startup. With CACHE_DRIVER=auto we try to PING Redis and
// fall back to the in-memory implementation when it is unreachable.
export async function initCache(): Promise<Cache> {
  if (cache) return cache;
  if (config.cacheDriver === 'memory') {
    cache = new MemoryCache();
    return cache;
  }
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    connectTimeout: 1500,
  });
  redis.on('error', () => {
    /* connection errors are handled by the fallback logic below */
  });
  try {
    await redis.connect();
    await redis.ping();
    cache = new RedisCache(redis);
  } catch {
    redis.disconnect();
    if (config.cacheDriver === 'redis') {
      throw new Error(`CACHE_DRIVER=redis but Redis is unreachable at ${config.redisUrl}`);
    }
    console.warn('[cache] Redis unreachable, falling back to in-memory cache');
    cache = new MemoryCache();
  }
  return cache;
}

export function getCache(): Cache {
  if (!cache) throw new Error('Cache not initialized — call initCache() first');
  return cache;
}
