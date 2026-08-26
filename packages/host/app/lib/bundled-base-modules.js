// The base realm's modules, compiled into the host bundle. Lives in an
// untyped .js module because `import.meta.glob` is a vite build-time
// construct that ember-tsc (module: nodenext, CJS-flavored app files)
// rejects; the .d.ts sibling carries the type.
const BASE_MODULES = import.meta.glob(
  [
    '../../../base/**/*.{gts,ts}',
    '!../../../base/node_modules/**',
    '!../../../base/**/*.d.ts',
  ],
  { eager: true },
);

export default BASE_MODULES;
