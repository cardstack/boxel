import { isEnvironmentMode, serviceURL } from '../lib/dev-service-registry';

export const defaultPrerenderManagerURL = isEnvironmentMode()
  ? serviceURL('prerender-mgr')
  : 'http://localhost:4222';

export function resolvePrerenderManagerURL(): string {
  let base = process.env.PRERENDER_MANAGER_URL ?? defaultPrerenderManagerURL;
  return base.replace(/\/$/, '');
}
