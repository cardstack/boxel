// Rewrites `import.meta.loader` in the modules `include` accepts to the
// global the host's loader service keeps its current loader in. A Loader
// gives each module it evaluates `import.meta.loader`; a module compiled into
// the host bundle is evaluated by the platform instead, so it reads the
// service's loader from the global.
module.exports = function importMetaLoaderPlugin(babel) {
  let t = babel.types;
  return {
    name: 'import-meta-loader',
    visitor: {
      MemberExpression(path, state) {
        let { node } = path;
        if (
          node.computed ||
          node.property.type !== 'Identifier' ||
          node.property.name !== 'loader' ||
          node.object.type !== 'MetaProperty' ||
          node.object.meta.name !== 'import' ||
          node.object.property.name !== 'meta'
        ) {
          return;
        }
        if (!state.filename || !state.opts.include(state.filename)) {
          return;
        }
        path.replaceWith(
          t.memberExpression(
            t.identifier('globalThis'),
            t.identifier(state.opts.globalName),
          ),
        );
      },
    },
  };
};
