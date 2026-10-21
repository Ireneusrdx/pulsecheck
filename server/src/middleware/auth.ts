import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// Extends Express' Request with the authenticated user's id.
declare global {
  namespace Express {
    interface Request {
      userId?: number;
    }
  }
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }
  try {
    const payload = jwt.verify(header.slice('Bearer '.length), config.jwtSecret) as unknown as {
      sub: number | string;
    };
    req.userId = Number(payload.sub);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
