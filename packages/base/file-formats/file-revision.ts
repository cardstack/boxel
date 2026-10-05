// A file's URL stays put when the file is written; its content revision does
// not. Previews that load a file's bytes by URL key their loads on the revision
// so a write reaches a preview that stays mounted while the store reloads the
// FileDef. This module sits in card-api's universal dependency graph (the image
// primitive reaches it), so it imports nothing.

// Anything that carries a file's indexed revision: a FileDef, its view model,
// or a plain wire-shape object.
export interface FileRevisionLike {
  contentHash?: string | null;
  lastModified?: string | number | Date | null;
}

// Names the bytes the index last saw. The content hash alone isn't enough:
// above its whole-content limit it samples only the length and the two ends,
// so an edit confined to the middle of a large file keeps the same hash.
// Joining the modification time catches that edit, the same way the realm's
// ETags treat a sampled hash. Empty when the file carries neither.
export function fileContentRevision(file?: FileRevisionLike | null): string {
  let hash = file?.contentHash ?? '';
  let modified = file?.lastModified ?? '';
  if (modified instanceof Date) {
    modified = Number.isNaN(modified.getTime()) ? '' : modified.toISOString();
  }
  if (!hash && modified === '') {
    return '';
  }
  return `${hash}:${modified}`;
}

// The URL a native element (`<img>`, `<audio>`, `<video>`, `<object>`) loads,
// with the revision in a `rev` query parameter. Those elements re-request only
// when their URL changes, and the browser's image cache serves a repeated URL
// from memory, so a write has to produce a new URL. The realm resolves a file
// by its path and ignores the query, and the auth service worker matches realm
// URLs by prefix. Only the element gets this URL: links, downloads, and
// copy-link keep the file's own URL. Object and data URLs pass through.
export function urlAtRevision(url: string, revision: string): string {
  if (!url || !revision || /^(?:blob|data):/i.test(url)) {
    return url;
  }
  let hashIndex = url.indexOf('#');
  let fragment = hashIndex === -1 ? '' : url.slice(hashIndex);
  let base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  let separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}rev=${encodeURIComponent(revision)}${fragment}`;
}
