import http from 'http';
import { pool } from '../src/db';
import { runMigrations } from '../src/scripts/migrate';

export async function prepareDb(): Promise<void> {
  await runMigrations();
  await clearDb();
}

export async function clearDb(): Promise<void> {
  await pool.query(
    'TRUNCATE incidents, checks, monitors, users RESTART IDENTITY CASCADE'
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}

export interface StubServer {
  url: string;
  setStatus(code: number): void;
  close(): Promise<void>;
}

/**
 * A tiny local HTTP target whose response status can be flipped between
 * 200 and 500, so tests can drive a monitor up and down deterministically.
 */
export async function startStubServer(): Promise<StubServer> {
  let status = 200;
  const server = http.createServer((_req, res) => {
    // Small artificial latency so latency measurements are meaningful.
    setTimeout(() => {
      res.writeHead(status, { 'content-type': 'text/plain' });
      res.end(status === 200 ? 'ok' : 'boom');
    }, 5);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('stub server failed to bind');
  return {
    url: `http://127.0.0.1:${address.port}/`,
    setStatus(code: number) {
      status = code;
    },
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      ),
  };
}
