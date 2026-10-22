/**
 * The URL of a file in this realm, from its path in the realm: `asset/…`,
 * `film-app/…`. Resolved against this module's own URL, which is where the
 * realm serves it.
 */
export function realmFile(path: string): string {
  return new URL(`../${path}`, HERE).href;
}

// The realm loads every module as an ES module, so `import.meta.url` is this
// module's URL. The package type-checks under `nodenext` as CommonJS, which
// rejects the syntax (TS1470) though the realm never compiles to CommonJS.
// @ts-expect-error TS1470, as above
const HERE: string = import.meta.url;
