// Module shim for `@joplin/turndown-plugin-gfm`, which ships untyped CJS.
// Only the named exports we actually use are declared. The plugin functions
// take a `TurndownService` instance and mutate it in place; the return type
// from upstream is `void`, but `service.use(plugin)` accepts that.

declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';

  type GfmPlugin = (service: TurndownService) => void;

  export const gfm: GfmPlugin;
  export const tables: GfmPlugin;
  export const strikethrough: GfmPlugin;
  export const taskListItems: GfmPlugin;
}
