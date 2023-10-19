## Notes on rebuild scripts

### `pnpm rebuild:icons`

Icon components in addon/src/icons are code-generated from svg files using `pnpm rebuild:icons` from the addon project. This script also generates src/icons.ts, which is the module that re-exports the icons for consumers of this addon.

This script should be run when an icon is added, removed, updated, or renamed.

### `pnpm rebuild:usage`

This script generates src/usage.ts, which is the module that re-exports the usage files for the test-app to include in it's component explorer UI.

This script should be run when a usage file is added, removed, or renamed.
