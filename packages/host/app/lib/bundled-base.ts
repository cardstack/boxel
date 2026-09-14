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

// Registers on the virtual network, so every loader that shares it serves the
// bundled modules. Must run after the `@cardstack/base/` realm mapping is
// registered: a shim id resolves at registration time, and it has to land on
// the same realm URL a loader import of the id resolves to.
export function shimBundledBase(virtualNetwork: VirtualNetwork) {
  for (let [name, resolve] of Object.entries(BUNDLED_BASE_MODULES)) {
    virtualNetwork.shimAsyncModule({ id: `@cardstack/base/${name}`, resolve });
  }
}
