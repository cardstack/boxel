// The `--boxel-dropdown-*` custom properties a BoxelSelect copies from its
// trigger onto the shared `#ember-basic-dropdown-wormhole`, so that the
// select's dropdown, rendered in the wormhole rather than under the trigger,
// inherits the trigger's overrides.
//
// Every BoxelDropdown renders in the same wormhole, and its content resolves
// the same properties (a hovered menu item's text takes
// `--boxel-dropdown-selected-text-color` before the dropdown's own text
// color), so a BoxelDropdown removes these from the wormhole before its
// content first paints. The dropdown's content then starts from the
// overrides its own `@contentClass` carries and the theme fallbacks.
export const SELECT_WORMHOLE_KNOBS = [
  '--boxel-dropdown-background-color',
  '--boxel-dropdown-border-color',
  '--boxel-dropdown-text-color',
  '--boxel-dropdown-selected-text-color',
  '--boxel-dropdown-focus-border-color',
  '--boxel-dropdown-highlight-color',
  '--boxel-dropdown-highlight-hover-color',
  '--boxel-dropdown-selected-highlighted-color',
  '--boxel-dropdown-selected-hover-color',
  '--boxel-dropdown-hover-color',
  '--boxel-dropdown-hover-text-color',
  '--boxel-form-control-border-radius',
] as const;
