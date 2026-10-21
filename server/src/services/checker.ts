import { CheckResult } from '../repositories/checkRepository';
import { MonitorRow } from '../repositories/monitorRepository';

/**
 * Performs a single HTTP check against a monitor's URL.
 * A check is "ok" when the response arrives before the timeout and its
 * status code falls inside the monitor's expected range.
 * Never throws — every failure mode is reported in the result.
 */
export async function performCheck(
  monitor: Pick<MonitorRow, 'url' | 'method' | 'timeout_ms' | 'expected_status_min' | 'expected_status_max'>
): Promise<CheckResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), monitor.timeout_ms);
  const startedAt = performance.now();
  try {
    const response = await fetch(monitor.url, {
      method: monitor.method,
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'PulseCheck/1.0 (+uptime-monitor)' },
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    // Drain the body so the connection can be released.
    await response.arrayBuffer().catch(() => undefined);
    const ok =
      response.status >= monitor.expected_status_min &&
      response.status <= monitor.expected_status_max;
    return {
      ok,
      statusCode: response.status,
      latencyMs,
      error: ok ? null : `Unexpected status ${response.status}`,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - startedAt);
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, statusCode: null, latencyMs, error: `Timeout after ${monitor.timeout_ms}ms` };
    }
    return {
      ok: false,
      statusCode: null,
      latencyMs,
      error: err instanceof Error ? err.message : 'Unknown network error',
    };
  } finally {
    clearTimeout(timer);
  }
}
