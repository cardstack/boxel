import { waitForPromise } from '@ember/test-waiters';

import type { VirtualNetwork } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

// Written by the `bundled-base-scoped-css` vite plugin: each bundled base
// module registers the scoped-CSS specifiers its compiled source imports and
// the sibling base modules it pulls in, as it is evaluated.
// See packages/host/lib/bundled-base-scoped-css.mjs.
interface BundledBaseModuleImports {
  css: string[];
  imports: string[];
  reexports: string[];
}

const scopedCSSRegistry = () =>
  (
    globalThis as {
      __boxelBundledBaseScopedCSS?: Record<string, BundledBaseModuleImports>;
    }
  ).__boxelBundledBaseScopedCSS;

// The stylesheet specifiers of `name` together with those of every base module
// reachable from it. A module the loader is never asked for — one only ever
// reached from inside another module's chunk — gets no chance to declare its
// own stylesheet, so whatever pulls it in declares it on its behalf.
function scopedCSSDepsFor(name: string): string[] {
  let registry = scopedCSSRegistry();
  if (!registry) {
    return [];
  }
  let deps: string[] = [];
  let seen = new Set<string>();
  let queue = [name];
  while (queue.length) {
    let current = queue.shift()!;
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    let entry = registry[current];
    if (!entry) {
      continue;
    }
    for (let specifier of entry.css) {
      deps.push(rebaseSpecifier(name, current, specifier));
    }
    queue.push(...entry.imports);
  }
  return deps;
}

// A declared dep is resolved against the URL of the module that declared it,
// so a specifier borrowed from elsewhere in the bundle has to be rewritten to
// point at the same file from the borrower's directory. `./embedded.gts…css`,
// as `default-templates/embedded` spells it, becomes `./default-templates/
// embedded.gts…css` when `card-api` declares it.
function rebaseSpecifier(
  fromName: string,
  declaringName: string,
  specifier: string,
): string {
  if (fromName === declaringName) {
    return specifier;
  }
  let target = declaringName.split('/').slice(0, -1);
  for (let part of specifier.split('/')) {
    if (part === '.' || part === '') {
      continue;
    } else if (part === '..') {
      target.pop();
    } else {
      target.push(part);
    }
  }
  let up = fromName
    .split('/')
    .slice(0, -1)
    .map(() => '..');
  return [...(up.length ? up : ['.']), ...target].join('/');
}

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
  // card-api declares the classes every other base module extends, so it is
  // bundled first and unconditionally: while it is fetched and anything else is
  // bundled, a bundled module extends the build's FieldDef while a fetched one
  // extends the loader's, and nothing that compares the two agrees. Serving it
  // from the bundle collapses both onto one set of classes.
  //
  // card-api's own imports follow it for the same reason, and this set has to
  // stay closed under imports: the bundler resolves a bundled module's imports
  // into its chunk, so a module reachable from a bundled one but missing here
  // is bundled anyway AND fetched separately when card code imports it by
  // identifier — two copies, whose classes and module state do not match.
  'card-api': () => import('@cardstack/base/card-api'),
  '-private': () => import('@cardstack/base/-private'),
  'card-serialization': () => import('@cardstack/base/card-serialization'),
  'contains-many-component': () =>
    import('@cardstack/base/contains-many-component'),
  'default-templates/atom': () =>
    import('@cardstack/base/default-templates/atom'),
  'default-templates/card-info': () =>
    import('@cardstack/base/default-templates/card-info'),
  'default-templates/embedded': () =>
    import('@cardstack/base/default-templates/embedded'),
  'default-templates/field-edit': () =>
    import('@cardstack/base/default-templates/field-edit'),
  'default-templates/file-def-atom': () =>
    import('@cardstack/base/default-templates/file-def-atom'),
  'default-templates/file-def-edit': () =>
    import('@cardstack/base/default-templates/file-def-edit'),
  'default-templates/file-def-embedded': () =>
    import('@cardstack/base/default-templates/file-def-embedded'),
  'default-templates/file-def-fitted': () =>
    import('@cardstack/base/default-templates/file-def-fitted'),
  'default-templates/file-def-isolated': () =>
    import('@cardstack/base/default-templates/file-def-isolated'),
  'default-templates/fitted': () =>
    import('@cardstack/base/default-templates/fitted'),
  'default-templates/head': () =>
    import('@cardstack/base/default-templates/head'),
  'default-templates/isolated-and-edit': () =>
    import('@cardstack/base/default-templates/isolated-and-edit'),
  'default-templates/markdown': () =>
    import('@cardstack/base/default-templates/markdown'),
  'default-templates/markdown-fallback': () =>
    import('@cardstack/base/default-templates/markdown-fallback'),
  'default-templates/missing-template': () =>
    import('@cardstack/base/default-templates/missing-template'),
  'field-component': () => import('@cardstack/base/field-component'),
  'field-support': () => import('@cardstack/base/field-support'),
  'file-api': () => import('@cardstack/base/file-api'),
  'file-formats/file-image': () =>
    import('@cardstack/base/file-formats/file-image'),
  'file-formats/file-presentation': () =>
    import('@cardstack/base/file-formats/file-presentation'),
  'file-formats/file-preview-stage': () =>
    import('@cardstack/base/file-formats/file-preview-stage'),
  'file-formats/file-shell-atom': () =>
    import('@cardstack/base/file-formats/file-shell-atom'),
  'file-formats/file-shell-embedded': () =>
    import('@cardstack/base/file-formats/file-shell-embedded'),
  'file-formats/file-shell-fitted': () =>
    import('@cardstack/base/file-formats/file-shell-fitted'),
  'file-formats/file-shell-isolated': () =>
    import('@cardstack/base/file-formats/file-shell-isolated'),
  'file-formats/file-type-profile': () =>
    import('@cardstack/base/file-formats/file-type-profile'),
  'file-formats/file-view-model': () =>
    import('@cardstack/base/file-formats/file-view-model'),
  'file-formats/image-captures': () =>
    import('@cardstack/base/file-formats/image-captures'),
  'file-formats/image-preview': () =>
    import('@cardstack/base/file-formats/image-preview'),
  'file-menu-items': () => import('@cardstack/base/file-menu-items'),
  'helpers/clock': () => import('@cardstack/base/helpers/clock'),
  'helpers/sanitized-html': () =>
    import('@cardstack/base/helpers/sanitized-html'),
  'helpers/set-background-image': () =>
    import('@cardstack/base/helpers/set-background-image'),
  'links-to-editor': () => import('@cardstack/base/links-to-editor'),
  'links-to-many-component': () =>
    import('@cardstack/base/links-to-many-component'),
  'markdown-helpers': () => import('@cardstack/base/markdown-helpers'),
  'menu-items': () => import('@cardstack/base/menu-items'),
  'query-field-support': () => import('@cardstack/base/query-field-support'),
  'shared-state': () => import('@cardstack/base/shared-state'),
  'text-input-validator': () => import('@cardstack/base/text-input-validator'),
  'watched-array': () => import('@cardstack/base/watched-array'),
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
  'codemirror-editor': () => import('@cardstack/base/codemirror-editor'),
  'color-field/components/advanced-color-picker': () =>
    import('@cardstack/base/color-field/components/advanced-color-picker'),
  'color-field/components/color-picker-field': () =>
    import('@cardstack/base/color-field/components/color-picker-field'),
  'color-field/components/color-wheel-picker': () =>
    import('@cardstack/base/color-field/components/color-wheel-picker'),
  'color-field/components/contrast-checker-addon': () =>
    import('@cardstack/base/color-field/components/contrast-checker-addon'),
  'color-field/components/recent-colors-addon': () =>
    import('@cardstack/base/color-field/components/recent-colors-addon'),
  'color-field/components/slider-picker': () =>
    import('@cardstack/base/color-field/components/slider-picker'),
  'color-field/components/swatches-picker': () =>
    import('@cardstack/base/color-field/components/swatches-picker'),
  'color-field/modifiers/setup-element-modifier': () =>
    import('@cardstack/base/color-field/modifiers/setup-element-modifier'),
  'color-field/util/color-field-signature': () =>
    import('@cardstack/base/color-field/util/color-field-signature'),
  'color-field/util/color-utils': () =>
    import('@cardstack/base/color-field/util/color-utils'),
  'color-field/util/css-color-parsers': () =>
    import('@cardstack/base/color-field/util/css-color-parsers'),
  command: () => import('@cardstack/base/command'),
  'commands/search-card-result': () =>
    import('@cardstack/base/commands/search-card-result'),
  'components/markdown-editor-mode-select': () =>
    import('@cardstack/base/components/markdown-editor-mode-select'),
  'components/time-slots': () =>
    import('@cardstack/base/components/time-slots'),
  'json-field': () => import('@cardstack/base/json-field'),
  'number/components/badge-counter': () =>
    import('@cardstack/base/number/components/badge-counter'),
  'number/components/badge-metric': () =>
    import('@cardstack/base/number/components/badge-metric'),
  'number/components/badge-notification': () =>
    import('@cardstack/base/number/components/badge-notification'),
  'number/components/gauge': () =>
    import('@cardstack/base/number/components/gauge'),
  'number/components/progress-bar': () =>
    import('@cardstack/base/number/components/progress-bar'),
  'number/components/progress-circle': () =>
    import('@cardstack/base/number/components/progress-circle'),
  'number/components/score': () =>
    import('@cardstack/base/number/components/score'),
  'number/components/stat': () =>
    import('@cardstack/base/number/components/stat'),
  'number/util/index': () => import('@cardstack/base/number/util/index'),
  'resources/command-data': () =>
    import('@cardstack/base/resources/command-data'),
  'response-field': () => import('@cardstack/base/response-field'),
  skill: () => import('@cardstack/base/skill'),
  spec: () => import('@cardstack/base/spec'),
  'tool-field': () => import('@cardstack/base/tool-field'),
};

// A loader credits the first module it serves with every binding that module's
// namespace exposes, so a re-exporter served ahead of the module that declares
// the class takes the credit — `identifyCard` then reports `file-api` for a
// `FileDef` that `card-api` declares, and the adoption-chain walk, which stops
// at the module a code ref names, walks past it and fails. A module the loader
// fetches cannot get this wrong: evaluating it loads what it re-exports from
// first. A bundled module can, because the bundler resolves that import inside
// the chunk where the loader never sees it, so the declarer is served here
// before the module that borrows from it.
//
// Each source is imported through the loader that published itself for bundled
// modules to reach, which is the loader doing the serving. A source that is not
// a bundled module, or a loader that cannot load it, leaves the order as it was
// rather than failing the module that asked.
async function serveDeclarersFirst(
  name: string,
  resolve: () => Promise<Record<string, unknown>>,
) {
  for (let source of scopedCSSRegistry()?.[name]?.reexports ?? []) {
    if (!(source in BUNDLED_BASE_MODULES) || servingDeclarer.has(source)) {
      continue;
    }
    servingDeclarer.add(source);
    try {
      await Loader.forBundledModules()?.import(`@cardstack/base/${source}`);
    } catch {
      // ignored: see above
    } finally {
      servingDeclarer.delete(source);
    }
  }
  return resolve();
}

// Guards the case of two modules that re-export from each other: the second
// serve finds its source already in flight and goes ahead without it, rather
// than waiting on a module that is waiting on it.
const servingDeclarer = new Set<string>();

// Registers on the virtual network, so every loader that shares it serves the
// bundled modules. Must run after the `@cardstack/base/` realm mapping is
// registered: a shim id resolves at registration time, and it has to land on
// the same realm URL a loader import of the id resolves to.
export function shimBundledBase(virtualNetwork: VirtualNetwork) {
  for (let [name, resolve] of Object.entries(BUNDLED_BASE_MODULES)) {
    // Each bundled module registers its own scoped-CSS specifiers as it is
    // evaluated, so this reads them only once the module has been served —
    // which is exactly when the loader asks what it consumed.
    virtualNetwork.shimAsyncModule({
      id: `@cardstack/base/${name}`,
      // A module served from the bundle resolves without touching the network,
      // so nothing about it reaches the runloop and a test settles before the
      // module has been evaluated. Naming the import to the test waiters keeps
      // `settled()` waiting for it, as it waits for the fetch this replaces.
      resolve: () =>
        waitForPromise(
          serveDeclarersFirst(name, resolve),
          `bundled base: ${name}`,
        ),
      deps: () => scopedCSSDepsFor(name),
    });
  }
}
