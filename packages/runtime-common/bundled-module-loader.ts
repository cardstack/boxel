// The global a base module compiled into the host bundle reads its loader
// from. A Loader gives each module it evaluates `import.meta.loader`; the
// platform evaluates a bundled module, so the host's build rewrites that read
// to this global (packages/host/lib/import-meta-loader-plugin.cjs), and the
// host's loader service keeps its current loader in it.
export const bundledModuleLoaderGlobal = '__boxelLoader';
