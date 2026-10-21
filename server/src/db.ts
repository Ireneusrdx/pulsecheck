import { Pool } from 'pg';
import { config } from './config';

// Single shared connection pool for the whole process.
export const pool = new Pool({ connectionString: config.databaseUrl });

export async function query<T = any>(text: string, params?: unknown[]): Promise<T[]> {
  const result = await pool.query(text, params as any[]);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: unknown[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}
