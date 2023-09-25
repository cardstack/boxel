'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { Webpack } = require('@embroider/webpack');
const { compatBuild } = require('@embroider/compat');

module.exports = function (defaults) {
  const app = new EmberApp(defaults, {
    // Add options here
    autoImport: {
      watchDependencies: ['@cardstack/boxel-ui'],
    },
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
    },
  });

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
              test: /\.ttf$/,
              type: 'asset',
            },
          ],
        },    
      },
    },
  });
};
