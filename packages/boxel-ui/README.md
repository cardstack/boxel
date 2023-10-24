## How to build this addon

### `pnpm build` in the addon/ dir

This command runs the rollup build to create the consumable v2 addon format that is used by the test-app as well as the host package.

### Or... `pnpm start` in the addon/ dir

This command does the same thing as `pnpm build` but then watches for changes to the addon directory and re-runs the build when somethng changes.

## Notes on rebuild scripts

These scripts do not run as part of the build steps above and should be run when changes you have made dictate.

### `pnpm rebuild:icons`

Icon components in addon/src/icons are code-generated from svg files using `pnpm rebuild:icons` from the addon project. This script also generates src/icons.ts, which is the module that re-exports the icons for consumers of this addon.

This script should be run when an icon is added, removed, updated, or renamed.

### `pnpm rebuild:usage`

This script generates src/usage.ts, which is the module that re-exports the usage files for the test-app to include in it's component explorer UI.

This script should be run when a usage file is added, removed, or renamed.
