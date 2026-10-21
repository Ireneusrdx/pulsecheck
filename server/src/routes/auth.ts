import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { signToken } from '../middleware/auth';
import { rateLimit } from '../lib/rateLimit';
import { createUser, findUserByEmail } from '../repositories/userRepository';

const router = Router();

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

router.post('/register', rateLimit('auth', 30, 15 * 60 * 1000), async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
    return;
  }
  const { email, password } = parsed.data;
  const existing = await findUserByEmail(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists' });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await createUser(email, passwordHash);
  res.status(201).json({ token: signToken(user.id), user: { id: user.id, email: user.email } });
});

router.post('/login', rateLimit('auth', 30, 15 * 60 * 1000), async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid input' });
    return;
  }
  const { email, password } = parsed.data;
  const user = await findUserByEmail(email);
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }
  res.json({ token: signToken(user.id), user: { id: user.id, email: user.email } });
});

export default router;
