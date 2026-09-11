import type { VirtualNetwork } from '@cardstack/runtime-common';

// Base modules compiled into the host bundle, keyed by their path under
// `@cardstack/base/`. Each is served to the loader in place of a fetch of the
// module from the base realm; the literal `import()` per entry is what lets
// Vite give each module its own chunk.
//
// Registered from a table, as the host tools are, rather than as literal
// `shimAsyncModule` calls in externals.ts: the boxel-cli guard that reads
// literal shim ids out of that file covers `@cardstack/base/*` through its
// path alias already, so nothing is lost to it here.
export const BUNDLED_BASE_MODULES: Record<
  string,
  () => Promise<Record<string, unknown>>
> = {
  'date/day': () => import('@cardstack/base/date/day'),
  'date/month': () => import('@cardstack/base/date/month'),
  'date/month-day': () => import('@cardstack/base/date/month-day'),
  'date/month-year': () => import('@cardstack/base/date/month-year'),
  'date/year': () => import('@cardstack/base/date/year'),
  'date/week': () => import('@cardstack/base/date/week'),
  'date/quarter': () => import('@cardstack/base/date/quarter'),
  time: () => import('@cardstack/base/time'),
  'time/time-range': () => import('@cardstack/base/time/time-range'),
  'time/duration': () => import('@cardstack/base/time/duration'),
  'time/relative-time': () => import('@cardstack/base/time/relative-time'),
  // string.ts is `export default StringField` from card-api, so it is
  // resolved there. Importing string.ts itself would have TypeScript classify
  // that `.ts` module as CommonJS (this package declares no `type`) and
  // retype its default export as a namespace for every host importer.
  string: () =>
    import('@cardstack/base/card-api').then(({ StringField }) => ({
      default: StringField,
    })),
  number: () => import('@cardstack/base/number'),
  boolean: () => import('@cardstack/base/boolean'),
  'big-integer': () => import('@cardstack/base/big-integer'),
  email: () => import('@cardstack/base/email'),
  'ethereum-address': () => import('@cardstack/base/ethereum-address'),
  'phone-number': () => import('@cardstack/base/phone-number'),
  'text-area': () => import('@cardstack/base/text-area'),
  markdown: () => import('@cardstack/base/markdown'),
  'rich-markdown': () => import('@cardstack/base/rich-markdown'),
  color: () => import('@cardstack/base/color'),
  'code-ref': () => import('@cardstack/base/code-ref'),
  realm: () => import('@cardstack/base/realm'),
  enum: () => import('@cardstack/base/enum'),
  searchable: () => import('@cardstack/base/searchable'),
  'base64-image': () => import('@cardstack/base/base64-image'),
};

// Registers on the virtual network, so every loader that shares it serves the
// bundled modules. Must run after the `@cardstack/base/` realm mapping is
// registered: a shim id resolves at registration time, and it has to land on
// the same realm URL a loader import of the id resolves to.
export function shimBundledBase(virtualNetwork: VirtualNetwork) {
  for (let [name, resolve] of Object.entries(BUNDLED_BASE_MODULES)) {
    virtualNetwork.shimAsyncModule({ id: `@cardstack/base/${name}`, resolve });
  }
}
