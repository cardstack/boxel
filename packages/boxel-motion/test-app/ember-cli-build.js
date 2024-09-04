/* eslint-disable @typescript-eslint/no-var-requires */
'use strict';

const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { GlimmerScopedCSSWebpackPlugin } = require('glimmer-scoped-css/webpack');

const withSideWatch = require('./lib/with-side-watch');

module.exports = function (defaults) {
  let app = new EmberApp(defaults, {
    // Add options here
    autoImport: {
      watchDependencies: ['@cardstack/boxel-motion'],
    },
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
    },
    trees: {
      app: withSideWatch('app', {
        watching: ['../addon'],
      }),
    },
  });

  app.import('node_modules/normalize.css/normalize.css');
  app.import('vendor/app.css');
  app.import('vendor/card.css');
  app.import('vendor/tailwind-utilities-min.css');

  return compatBuild(app, Webpack, {
    skipBabel: [
      {
        package: 'qunit',
      },
    ],
    staticAddonTestSupportTrees: true,
    staticAddonTrees: true,
    // staticHelpers: true,
    // staticComponents: true,
    // staticAppPaths: [],
    packagerOptions: {
      webpackConfig: {
        module: {
          rules: [
            {
              test: /\.woff2$/,
              type: 'asset',
            },
          ],
        },
        plugins: [new GlimmerScopedCSSWebpackPlugin()],
      },
    },
  });
};
