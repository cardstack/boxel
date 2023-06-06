'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');

module.exports = function (defaults) {
  const app = new EmberApp(defaults, {
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
    },
  });
  return compatBuild(app, Webpack, {
    staticAddonTrees: true,
    staticAddonTestSupportTrees: true,
    staticHelpers: true,

    staticComponents: true,

    staticModifiers: true,
    staticAppPaths: ['lib'],

    packagerOptions: {
      ...{
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
            new webpack.IgnorePlugin({
              // workaround for https://github.com/embroider-build/ember-auto-import/issues/578
              resourceRegExp: /moment-timezone/,
            }),
            new webpack.IgnorePlugin({
              resourceRegExp: /^https:\/\/cardstack\.com\/base/,
            }),
            new MomentLocalesPlugin({
              // 'en' is built into moment and cannot be removed. This strips the others.
              localesToKeep: [],
            }),
            new webpack.ProvidePlugin({
              atob: 'atob', // cardpay-sdk: ethers base64
            }),
          ],
          resolve: {
            fallback: {
              fs: false,
              path: require.resolve('path-browserify'),
              crypto: require.resolve('crypto-browserify'),
              stream: require.resolve('stream-browserify'),
              process: false,
              // cardpay-sdk polyfills
              http: require.resolve('stream-http'),
              https: require.resolve('https-browserify'),
              os: require.resolve('os-browserify/browser'),
            },
          },
          node: {
            global: true,
          },
        },
      },
    },
  });
};
