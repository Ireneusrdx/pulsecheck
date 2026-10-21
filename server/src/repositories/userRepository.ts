import { queryOne } from '../db';

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
}

export async function createUser(email: string, passwordHash: string): Promise<UserRow> {
  const user = await queryOne<UserRow>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *',
    [email, passwordHash]
  );
  return user!;
}

export async function findUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
}
