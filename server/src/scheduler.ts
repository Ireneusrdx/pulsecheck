import { config } from './config';
import { getQueue } from './lib/queue';
import { listDueMonitors } from './repositories/monitorRepository';
import { runCheckForMonitor } from './services/monitorService';

/**
 * The scheduler runs two loops:
 *  1. a producer tick every SCHEDULER_TICK_MS that finds due monitors and
 *     enqueues them (a Set guards against enqueueing the same monitor twice
 *     while it is still waiting / being checked);
 *  2. a worker loop that dequeues monitor ids and runs the checks.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inFlight = new Set<number>();

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const queue = getQueue();
    console.log(
      `[scheduler] started (tick ${config.schedulerTickMs}ms, queue driver: ${queue.driverName})`
    );
    this.timer = setInterval(() => {
      this.tick().catch((err) => console.error('[scheduler] tick failed:', err));
    }, config.schedulerTickMs);
    void this.tick();
    void this.workerLoop();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async tick(): Promise<void> {
    const due = await listDueMonitors(100);
    const queue = getQueue();
    for (const monitor of due) {
      if (this.inFlight.has(monitor.id)) continue;
      this.inFlight.add(monitor.id);
      await queue.enqueue(monitor.id);
    }
  }

  private async workerLoop(): Promise<void> {
    const queue = getQueue();
    while (this.running) {
      const monitorId = await queue.dequeue(1000);
      if (monitorId === null) continue;
      try {
        await runCheckForMonitor(monitorId);
      } catch (err) {
        console.error(`[scheduler] check for monitor ${monitorId} failed:`, err);
      } finally {
        this.inFlight.delete(monitorId);
      }
    }
  }
}
