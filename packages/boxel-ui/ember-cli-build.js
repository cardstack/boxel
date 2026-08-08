'use strict';
const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');

// This exists solely so the vite test pipeline (see vite.config.mjs) can run
// classicEmberSupport(): several dependencies still ship loose-mode
// templates that need the compat resolver. Publishing does not use it — see
// rollup.config.mjs.
module.exports = async function (defaults) {
  const { buildOnce } = await import('@embroider/vite');

  const app = new EmberApp(defaults, {});

  return compatBuild(app, buildOnce, {});
};
