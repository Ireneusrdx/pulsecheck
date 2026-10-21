import fs from 'fs';
import path from 'path';
import { pool } from '../db';

// Applies every .sql file in server/migrations/ that has not run yet,
// in filename order, each inside a transaction. Applied files are recorded
// in the schema_migrations table so re-running is safe.
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, '../../migrations');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
    if (applied.rowCount && applied.rowCount > 0) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

if (require.main === module) {
  runMigrations()
    .then(() => pool.end())
    .then(() => console.log('[migrate] done'))
    .catch(async (err) => {
      console.error('[migrate] failed:', err);
      await pool.end();
      process.exit(1);
    });
}
