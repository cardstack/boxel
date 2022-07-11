'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild, V1Addon } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const buildFunnel = require('broccoli-funnel');
const mergeTrees = require('broccoli-merge-trees');

module.exports = function (defaults) {
  let app = new EmberApp(defaults, {});
  return compatBuild(app, Webpack, {
    staticAddonTrees: true,
    staticAddonTestSupportTrees: true,
    staticHelpers: true,

    // needed to disable this to get embroider's resolver happy with gjs
    staticComponents: false,

    staticModifiers: true,
    staticAppPaths: ['lib'],

    packagerOptions: {
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
            Buffer: 'buffer',
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
