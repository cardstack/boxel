// `ignore` ships no `types`/`exports` fields, so its default export resolves
// inconsistently across toolchains: nodenext types it as a non-callable
// namespace, and esbuild (bundling downstream consumers) won't synthesize a
// default at all. Import the namespace and read the CJS default off it — that's
// the callable factory under native Node, esbuild, and Vite alike.
import type { Ignore } from 'ignore';
import * as ignoreNamespace from 'ignore';

export const ignore = ((ignoreNamespace as { default?: unknown }).default ??
  ignoreNamespace) as unknown as (options?: object) => Ignore;
export type { Ignore };
