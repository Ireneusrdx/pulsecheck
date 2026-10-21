import Redis from 'ioredis';
import { config } from '../config';

// A FIFO queue of monitor ids waiting to be checked. The scheduler produces,
// the worker consumes. RedisQueue is backed by a Redis list (LPUSH/BRPOP);
// MemoryQueue implements the same interface in-process as a fallback.
export interface CheckQueue {
  enqueue(monitorId: number): Promise<void>;
  /** Waits up to timeoutMs for the next monitor id; null on timeout. */
  dequeue(timeoutMs: number): Promise<number | null>;
  length(): Promise<number>;
  readonly driverName: string;
}

class MemoryQueue implements CheckQueue {
  readonly driverName = 'memory';
  private items: number[] = [];
  private waiters: Array<(id: number) => void> = [];

  async enqueue(monitorId: number): Promise<void> {
    const waiter = this.waiters.shift();
    if (waiter) waiter(monitorId);
    else this.items.push(monitorId);
  }

  async dequeue(timeoutMs: number): Promise<number | null> {
    const existing = this.items.shift();
    if (existing !== undefined) return existing;
    return new Promise((resolve) => {
      const waiter = (id: number) => {
        clearTimeout(timer);
        resolve(id);
      };
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(waiter);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  async length(): Promise<number> {
    return this.items.length;
  }
}

const QUEUE_KEY = 'pulsecheck:check-queue';

class RedisQueue implements CheckQueue {
  readonly driverName = 'redis';
  constructor(private redis: Redis) {}

  async enqueue(monitorId: number): Promise<void> {
    await this.redis.lpush(QUEUE_KEY, String(monitorId));
  }

  async dequeue(timeoutMs: number): Promise<number | null> {
    // BRPOP blocks server-side; use a dedicated connection in real
    // deployments — a single consumer loop is all PulseCheck runs.
    const result = await this.redis.brpop(QUEUE_KEY, Math.max(1, Math.ceil(timeoutMs / 1000)));
    if (!result) return null;
    return Number(result[1]);
  }

  async length(): Promise<number> {
    return this.redis.llen(QUEUE_KEY);
  }
}

let queue: CheckQueue | null = null;

export async function initQueue(): Promise<CheckQueue> {
  if (queue) return queue;
  if (config.queueDriver === 'memory') {
    queue = new MemoryQueue();
    return queue;
  }
  const redis = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null, // BRPOP should retry, not fail
    connectTimeout: 1500,
  });
  redis.on('error', () => {
    /* handled by fallback below / ioredis reconnects on its own */
  });
  try {
    await redis.connect();
    await redis.ping();
    queue = new RedisQueue(redis);
  } catch {
    redis.disconnect();
    if (config.queueDriver === 'redis') {
      throw new Error(`QUEUE_DRIVER=redis but Redis is unreachable at ${config.redisUrl}`);
    }
    console.warn('[queue] Redis unreachable, falling back to in-memory queue');
    queue = new MemoryQueue();
  }
  return queue;
}

export function getQueue(): CheckQueue {
  if (!queue) throw new Error('Queue not initialized — call initQueue() first');
  return queue;
}
