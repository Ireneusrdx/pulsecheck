import http from 'http';
import request from 'supertest';
import { createApp } from '../src/app';
import { initCache } from '../src/lib/cache';
import { initQueue } from '../src/lib/queue';
import { runCheckForMonitor } from '../src/services/monitorService';
import { closeDb, prepareDb, startStubServer, StubServer } from './helpers';

describe('PulseCheck end-to-end (API + checker + incidents + status)', () => {
  let token: string;
  let monitorId: number;
  let stub: StubServer;
  let webhookEvents: Array<{ event: string }> = [];
  let webhookServer: http.Server;

  const app = createApp();

  beforeAll(async () => {
    await prepareDb();
    await initCache();
    await initQueue();
    stub = await startStubServer();

    // A webhook receiver that records every event it gets.
    webhookServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          webhookEvents.push(JSON.parse(body));
        } catch {
          /* ignore malformed bodies */
        }
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((resolve) => webhookServer.listen(0, '127.0.0.1', resolve));
  });

  afterAll(async () => {
    await stub.close();
    await new Promise<void>((resolve) => webhookServer.close(() => resolve()));
    await closeDb();
  });

  it('rejects unauthenticated monitor access', async () => {
    await request(app).get('/api/monitors').expect(401);
  });

  it('registers and logs in a user', async () => {
    const register = await request(app)
      .post('/api/auth/register')
      .send({ email: 'owner@example.com', password: 'password123' })
      .expect(201);
    expect(register.body.token).toBeTruthy();

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: 'password123' })
      .expect(200);
    token = login.body.token;
    expect(token).toBeTruthy();
  });

  it('validates monitor input (interval below 30s is rejected)', async () => {
    await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'bad', url: stub.url, interval_seconds: 10 })
      .expect(400);
  });

  it('creates a monitor pointing at the stub server', async () => {
    const address = webhookServer.address();
    if (!address || typeof address === 'string') throw new Error('webhook server failed');
    const res = await request(app)
      .post('/api/monitors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'stub-service',
        url: stub.url,
        interval_seconds: 30,
        timeout_ms: 5000,
        webhook_url: `http://127.0.0.1:${address.port}/hook`,
      })
      .expect(201);
    monitorId = res.body.id;
    expect(res.body.current_status).toBe('unknown');
  });

  it('runs a check against the healthy stub and records it', async () => {
    const result = await runCheckForMonitor(monitorId);
    expect(result?.ok).toBe(true);
    expect(result?.statusCode).toBe(200);
    expect(result?.latencyMs).not.toBeNull();

    const checks = await request(app)
      .get(`/api/monitors/${monitorId}/checks`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(checks.body.total).toBe(1);
    expect(checks.body.checks[0].ok).toBe(true);

    const monitor = await request(app)
      .get(`/api/monitors/${monitorId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(monitor.body.current_status).toBe('up');
  });

  it('opens exactly one incident when the stub starts failing', async () => {
    stub.setStatus(500);
    const first = await runCheckForMonitor(monitorId);
    expect(first?.ok).toBe(false);
    const second = await runCheckForMonitor(monitorId);
    expect(second?.ok).toBe(false);

    const incidents = await request(app)
      .get(`/api/monitors/${monitorId}/incidents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(incidents.body).toHaveLength(1);
    expect(incidents.body[0].resolved_at).toBeNull();
    expect(incidents.body[0].cause).toContain('500');
  });

  it('resolves the incident when the stub recovers, and fires webhooks', async () => {
    stub.setStatus(200);
    const result = await runCheckForMonitor(monitorId);
    expect(result?.ok).toBe(true);

    const incidents = await request(app)
      .get(`/api/monitors/${monitorId}/incidents`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(incidents.body).toHaveLength(1);
    expect(incidents.body[0].resolved_at).not.toBeNull();
    expect(incidents.body[0].duration_seconds).toBeGreaterThanOrEqual(0);

    // Webhooks are fire-and-forget — poll briefly for both events.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const events = webhookEvents.map((e) => e.event);
      if (events.includes('incident.opened') && events.includes('incident.resolved')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const events = webhookEvents.map((e) => e.event);
    expect(events).toContain('incident.opened');
    expect(events).toContain('incident.resolved');
  });

  it('computes stats: 4 checks, 50% uptime, latency percentiles present', async () => {
    const stats = await request(app)
      .get(`/api/monitors/${monitorId}/stats?window=24h`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(stats.body.totalChecks).toBe(4);
    expect(stats.body.uptimePct).toBe(50);
    expect(stats.body.avgLatencyMs).not.toBeNull();
    expect(stats.body.p95LatencyMs).not.toBeNull();
    expect(stats.body.currentStatus).toBe('up');
  });

  it('exposes the monitor on the public status endpoint with its uptime', async () => {
    const status = await request(app).get('/api/status').expect(200);
    const entry = status.body.monitors.find((m: any) => m.id === monitorId);
    expect(entry).toBeTruthy();
    expect(entry.name).toBe('stub-service');
    expect(entry.status).toBe('up');
    expect(entry.uptime24h).toBe(50);
  });
});
