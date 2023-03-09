'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

module.exports = function (defaults) {
  let app = new EmberApp(defaults, {
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
    },
  });
  return compatBuild(app, Webpack, {
    staticAddonTrees: true,
    staticAddonTestSupportTrees: true,
    staticHelpers: true,

    // needed to disable this to get embroider's resolver happy with gjs
    staticComponents: false,

    staticModifiers: true,
    staticAppPaths: ['lib'],

    packagerOptions: {
      publicAssetURL: `/base/__boxel/`,
      webpackConfig: {
        devtool: 'source-map',
        module: {
          rules: [
            {
              test: /\.ttf$/,
              type: 'asset',
            },
          ],
        },
        plugins: [
          new MonacoWebpackPlugin(),
          new webpack.ProvidePlugin({
            process: 'process',
          }),
        ],
        resolve: {
          fallback: {
            fs: false,
            path: require.resolve('path-browserify'),
          },
        },
        node: {
          global: true,
        },
      },
    },
  });
};
