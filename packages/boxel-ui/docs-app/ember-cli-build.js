'use strict';
const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');

module.exports = async function (defaults) {
  const { buildOnce } = await import('@embroider/vite');

  const app = new EmberApp(defaults, {
    // Its `included` hook imports the CSS unlayered, which would outrank every
    // boxel-ui layer (and redefine `--radius` inside usage blocks). Opted out
    // here; app/vendor.css imports it into the `vendor` layer instead.
    'ember-freestyle': {
      includeStyles: false,
    },
  });

  return compatBuild(app, buildOnce, {});
};
