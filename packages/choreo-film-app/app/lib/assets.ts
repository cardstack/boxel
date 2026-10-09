/**
 * Where the films' media lives: the gallery realm's `asset/` directory, a
 * sibling of the directory this app is served from. The realm serves the app
 * at `film-app/` and the dev server serves it at the root with the realm as
 * its public directory, so the same relative URL finds the media in both.
 */
export function assetURL(path = ''): string {
  return new URL(`../asset/${path}`, document.baseURI).href;
}
