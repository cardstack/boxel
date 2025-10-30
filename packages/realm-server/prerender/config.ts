export const defaultPrerenderManagerURL = 'http://localhost:4222';

export function resolvePrerenderManagerURL(): string {
  let base = process.env.PRERENDER_MANAGER_URL ?? defaultPrerenderManagerURL;
  return base.replace(/\/$/, '');
}
