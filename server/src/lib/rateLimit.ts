import { NextFunction, Request, Response } from 'express';

// Minimal fixed-window rate limiter (per IP + limiter name). Good enough for
// a single-process deployment; a multi-instance deployment would move the
// counters into Redis behind the same interface.
export function rateLimit(name: string, limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      res.status(429).json({ error: 'Too many requests, slow down' });
      return;
    }
    next();
  };
}
