// `ignore` ships no `types`/`exports` fields, so under nodenext ESM-mode
// TypeScript types its default export as a non-callable namespace even though
// the runtime default IS the factory function (verified under native node).
// Re-export it once with the correct call signature so call sites stay clean.
import ignoreImport, { type Ignore } from 'ignore';

export const ignore = ignoreImport as unknown as (options?: object) => Ignore;
export type { Ignore };
