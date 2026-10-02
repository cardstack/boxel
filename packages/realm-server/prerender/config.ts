import { isEnvironmentMode, serviceURL } from '../lib/dev-service-registry.ts';

export const defaultPrerenderManagerURL = isEnvironmentMode()
  ? serviceURL('prerender-mgr')
  : 'http://localhost:4222';

export function resolvePrerenderManagerURL(): string {
  let base = process.env.PRERENDER_MANAGER_URL ?? defaultPrerenderManagerURL;
  return base.replace(/\/$/, '');
}

// Make a request from a prerender server to the manager, each on a connection
// of its own. The manager sits behind a load balancer that picks a task per
// connection, not per request, and keeps a deregistered task's open
// connections alive until the task stops. A heartbeat sent every few seconds
// never lets its kept-alive connection go idle, so during a manager deploy it
// stays on the old task for as long as that task drains, while callers opening
// new connections reach the new task and find no servers registered. Closing
// the connection after each response lets every request pick a task afresh.
// While both tasks are up, heartbeats spread across them, and each task
// typically hears from every server several times within the manager's
// heartbeat timeout. A server that misses one task for a whole timeout window
// is pruned there and added again on its next heartbeat. Once the old task
// drains it is never picked, so every heartbeat reaches the new one.
export function fetchFromManager(
  url: string | URL,
  init: RequestInit = {},
): Promise<Response> {
  let headers = new Headers(init.headers);
  headers.set('connection', 'close');
  return fetch(url, { ...init, headers });
}
