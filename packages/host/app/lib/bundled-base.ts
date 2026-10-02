import { waitForPromise } from '@ember/test-waiters';

import type { VirtualNetwork } from '@cardstack/runtime-common';

// Written by the `bundled-base-scoped-css` vite plugin: each bundled base
// module registers the scoped-CSS specifiers its compiled source imports and
// the sibling base modules it pulls in, as it is evaluated.
// See packages/host/lib/bundled-base-scoped-css.mjs.
interface BundledBaseModuleImports {
  css: string[];
  imports: string[];
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
// The base modules a bundled module may import while still leaving the set
// closed: each one's whole content is a re-export, so it is fetched on purpose
// and the copy the bundler puts in the chunk exposes the same class from that
// same chunk. Anything else a bundled module imports has to be bundled too —
// `Integration | bundled base modules` fails when it is not.
export const FETCHED_RE_EXPORTS = new Set([
  'string',
  'markdown',
  'text-area',
  'file-api',
]);

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
  //
  // Attribution does not decide what goes in this table. A bundled module
  // publishes the classes it declares as it is evaluated, and the loader reads
  // that registry before its own record, so a class is named by the module
  // that declares it whichever module was served first. `theme` and
  // `image-file-def` are bundled on that footing: each re-exports a class
  // `card-api` declares, and `card-api` keeps the credit.
  //
  // The closure rule is what keeps a module out. `command` imports
  // `commands/search-card-result`, `commands/search-entry-result` and
  // `markdown`; `commands/search-card-result` imports
  // `commands/search-result-list`. The table holds none of those four, so
  // neither importer can join it.
  //
  // `markdown`, `text-area`, `file-api`, `index`, `command-field` and
  // `file-formats/index` import nothing the table lacks. They are fetched
  // because bundling them is follow-on work, not because anything blocks it.
  // `string` has a reason of its own: it is `export default StringField` in a
  // `.ts`, so a dynamic `import()` of it here pulls that file into the
  // TypeScript program, where TS reads the `.ts` as CommonJS and retypes the
  // default export for every consumer.
  //
  // `FETCHED_RE_EXPORTS` lists the ones a bundled module still imports, which
  // are the ones the closure check has to allow.
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
  // `file-api` is deliberately NOT bundled. It declares nothing: it re-exports
  // `FileDef` and friends from card-api. A loader credits a class to the first
  // module it serves that exposes it, and a bundled module is served without
  // its re-export source being loaded first — so serving this one would make
  // every `FileDef` code ref name `@cardstack/base/file-api`, and the
  // adoption-chain walk, which stops at the module the family root names,
  // walks past it. Card code importing it keeps fetching it from the realm,
  // where evaluation loads card-api first and the identity comes out right.
  //
  // The file-def modules import it at runtime, which `FETCHED_RE_EXPORTS`
  // allows on the same argument that covers `string`: the bundler resolves the
  // re-export inside the importing chunk, so what it reaches is card-api's own
  // class, from the chunk card-api is already in.
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
  'time/duration': () => import('@cardstack/base/time/duration'),
  'time/relative-time': () => import('@cardstack/base/time/relative-time'),
  number: () => import('@cardstack/base/number'),
  boolean: () => import('@cardstack/base/boolean'),
  'big-integer': () => import('@cardstack/base/big-integer'),
  email: () => import('@cardstack/base/email'),
  'ethereum-address': () => import('@cardstack/base/ethereum-address'),
  'phone-number': () => import('@cardstack/base/phone-number'),
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
  // `command` and `commands/search-card-result` are out for the closure rule
  // above. `command` imports `./commands/search-card-result`,
  // `./commands/search-entry-result` and `./markdown`;
  // `commands/search-card-result` imports `./commands/search-result-list`.
  // This table holds none of those, so bundling either would compile its
  // siblings into that chunk while a direct import of a sibling still fetched
  // a separate copy. Bundling these two waits on their siblings.
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
  'components/age': () => import('@cardstack/base/components/age'),
  'components/business-days': () =>
    import('@cardstack/base/components/business-days'),
  'components/card-list': () => import('@cardstack/base/components/card-list'),
  'components/countdown': () => import('@cardstack/base/components/countdown'),
  'components/expiration-warning': () =>
    import('@cardstack/base/components/expiration-warning'),
  'components/time-ago': () => import('@cardstack/base/components/time-ago'),
  'components/timeline': () => import('@cardstack/base/components/timeline'),
  'frontmatter-field': () => import('@cardstack/base/frontmatter-field'),
  'helpers/country': () => import('@cardstack/base/helpers/country'),
  'join-the-community': () => import('@cardstack/base/join-the-community'),
  'llm-model': () => import('@cardstack/base/llm-model'),
  'matrix-event': () => import('@cardstack/base/matrix-event'),
  'number/components/number-input': () =>
    import('@cardstack/base/number/components/number-input'),
  operations: () => import('@cardstack/base/operations'),
  percentage: () => import('@cardstack/base/percentage'),
  'realm-config': () => import('@cardstack/base/realm-config'),
  'skill-reference': () => import('@cardstack/base/skill-reference'),
  'streaming-envelope': () => import('@cardstack/base/streaming-envelope'),
  tag: () => import('@cardstack/base/tag'),
  'ts-highlight': () => import('@cardstack/base/ts-highlight'),
  url: () => import('@cardstack/base/url'),
  'video-metadata': () => import('@cardstack/base/video-metadata'),
  'welcome-to-boxel': () => import('@cardstack/base/welcome-to-boxel'),
  'zip-archive': () => import('@cardstack/base/zip-archive'),
  'components/cards-grid-layout': () =>
    import('@cardstack/base/components/cards-grid-layout'),
  datetime: () => import('@cardstack/base/datetime'),
  image: () => import('@cardstack/base/image'),
  website: () => import('@cardstack/base/website'),
  'cards-grid': () => import('@cardstack/base/cards-grid'),
  'datetime-stamp': () => import('@cardstack/base/datetime-stamp'),
  'audio-file-def': () => import('@cardstack/base/audio-file-def'),
  'audio-metadata': () => import('@cardstack/base/audio-metadata'),
  'audio-waveform': () => import('@cardstack/base/audio-waveform'),
  'avif-meta-extractor': () => import('@cardstack/base/avif-meta-extractor'),
  'brand-functional-palette': () =>
    import('@cardstack/base/brand-functional-palette'),
  'brand-logo': () => import('@cardstack/base/brand-logo'),
  coordinate: () => import('@cardstack/base/coordinate'),
  country: () => import('@cardstack/base/country'),
  'css-value': () => import('@cardstack/base/css-value'),
  'csv-file-def': () => import('@cardstack/base/csv-file-def'),
  currency: () => import('@cardstack/base/currency'),
  date: () => import('@cardstack/base/date'),
  'docx-file-def': () => import('@cardstack/base/docx-file-def'),
  'docx-meta-extractor': () => import('@cardstack/base/docx-meta-extractor'),
  'exif-meta-extractor': () => import('@cardstack/base/exif-meta-extractor'),
  'file-formats/audio-preview': () =>
    import('@cardstack/base/file-formats/audio-preview'),
  'file-formats/file-resources': () =>
    import('@cardstack/base/file-formats/file-resources'),
  'file-formats/font-specimen': () =>
    import('@cardstack/base/file-formats/font-specimen'),
  'file-formats/html-preview': () =>
    import('@cardstack/base/file-formats/html-preview'),
  'file-formats/markdown-preview': () =>
    import('@cardstack/base/file-formats/markdown-preview'),
  'file-formats/metadata-fields': () =>
    import('@cardstack/base/file-formats/metadata-fields'),
  'file-formats/midi-preview': () =>
    import('@cardstack/base/file-formats/midi-preview'),
  'file-formats/model3d-captures': () =>
    import('@cardstack/base/file-formats/model3d-captures'),
  'file-formats/model3d-preview': () =>
    import('@cardstack/base/file-formats/model3d-preview'),
  'file-formats/office-captures': () =>
    import('@cardstack/base/file-formats/office-captures'),
  'file-formats/office-preview': () =>
    import('@cardstack/base/file-formats/office-preview'),
  'file-formats/pdf-captures': () =>
    import('@cardstack/base/file-formats/pdf-captures'),
  'file-formats/pdf-viewer': () =>
    import('@cardstack/base/file-formats/pdf-viewer'),
  'file-formats/video-captures': () =>
    import('@cardstack/base/file-formats/video-captures'),
  'file-formats/video-preview': () =>
    import('@cardstack/base/file-formats/video-preview'),
  'flac-meta-extractor': () => import('@cardstack/base/flac-meta-extractor'),
  'font-file-def': () => import('@cardstack/base/font-file-def'),
  'font-meta-extractor': () => import('@cardstack/base/font-meta-extractor'),
  'frontmatter-parse': () => import('@cardstack/base/frontmatter-parse'),
  'gif-meta-extractor': () => import('@cardstack/base/gif-meta-extractor'),
  'gltf-meta-extractor': () => import('@cardstack/base/gltf-meta-extractor'),
  'html-file-def': () => import('@cardstack/base/html-file-def'),
  'html-meta-extractor': () => import('@cardstack/base/html-meta-extractor'),
  'id3v2-parser': () => import('@cardstack/base/id3v2-parser'),
  'image-animation': () => import('@cardstack/base/image-animation'),
  'image-color-profile': () => import('@cardstack/base/image-color-profile'),
  'image-file-def': () => import('@cardstack/base/image-file-def'),
  'iso-bmff': () => import('@cardstack/base/iso-bmff'),
  'jpg-meta-extractor': () => import('@cardstack/base/jpg-meta-extractor'),
  'json-file-def': () => import('@cardstack/base/json-file-def'),
  'm4a-meta-extractor': () => import('@cardstack/base/m4a-meta-extractor'),
  'midi-audio-def': () => import('@cardstack/base/midi-audio-def'),
  'midi-meta-extractor': () => import('@cardstack/base/midi-meta-extractor'),
  'mp3-meta-extractor': () => import('@cardstack/base/mp3-meta-extractor'),
  'mp4-meta-extractor': () => import('@cardstack/base/mp4-meta-extractor'),
  'office-extract': () => import('@cardstack/base/office-extract'),
  'ogg-meta-extractor': () => import('@cardstack/base/ogg-meta-extractor'),
  ooxml: () => import('@cardstack/base/ooxml'),
  'pdf-file-def': () => import('@cardstack/base/pdf-file-def'),
  'pdf-meta-extractor': () => import('@cardstack/base/pdf-meta-extractor'),
  'png-image-def': () => import('@cardstack/base/png-image-def'),
  'png-meta-extractor': () => import('@cardstack/base/png-meta-extractor'),
  'pptx-file-def': () => import('@cardstack/base/pptx-file-def'),
  'pptx-meta-extractor': () => import('@cardstack/base/pptx-meta-extractor'),
  'process-card': () => import('@cardstack/base/process-card'),
  'stl-meta-extractor': () => import('@cardstack/base/stl-meta-extractor'),
  'svg-meta-extractor': () => import('@cardstack/base/svg-meta-extractor'),
  'text-file-def': () => import('@cardstack/base/text-file-def'),
  theme: () => import('@cardstack/base/theme'),
  'three-d-model-def': () => import('@cardstack/base/three-d-model-def'),
  'three-mf-meta-extractor': () =>
    import('@cardstack/base/three-mf-meta-extractor'),
  time: () => import('@cardstack/base/time'),
  'ts-file-def': () => import('@cardstack/base/ts-file-def'),
  'video-file-def': () => import('@cardstack/base/video-file-def'),
  'vorbis-comment-parser': () =>
    import('@cardstack/base/vorbis-comment-parser'),
  'wav-meta-extractor': () => import('@cardstack/base/wav-meta-extractor'),
  'webm-meta-extractor': () => import('@cardstack/base/webm-meta-extractor'),
  'webp-meta-extractor': () => import('@cardstack/base/webp-meta-extractor'),
  'xlsx-file-def': () => import('@cardstack/base/xlsx-file-def'),
  'xlsx-meta-extractor': () => import('@cardstack/base/xlsx-meta-extractor'),
  'zip-file-def': () => import('@cardstack/base/zip-file-def'),
};

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
      resolve: () => waitForPromise(resolve(), `bundled base: ${name}`),
      deps: () => scopedCSSDepsFor(name),
    });
  }
}
