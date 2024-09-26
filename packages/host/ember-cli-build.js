'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const { GlimmerScopedCSSWebpackPlugin } = require('glimmer-scoped-css/webpack');
const withSideWatch = require('./lib/with-side-watch');

module.exports = function (defaults) {
  const app = new EmberApp(defaults, {
    trees: {
      app: withSideWatch('app', {
        watching: ['../runtime-common', '../boxel-ui/addon'],
      }),
    },
    'ember-cli-babel': {
      enableTypeScriptTransform: true,
      disableDecoratorTransforms: true,
    },
    babel: {
      plugins: [
        [
          require.resolve('decorator-transforms'),
          {
            runtime: {
              import: require.resolve('decorator-transforms/runtime'),
            },
          },
        ],
      ],
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
                type: 'asset/inline',
              },
              {
                test: /\.woff2$/,
                type: 'asset',
              },
              {
                test: /\.png$/,
                type: 'asset',
              },
              {
                test: /\.webp$/,
                type: 'asset',
              },
              {
                test: /\.otf$/,
                type: 'asset',
              },
            ],
          },
          plugins: [
            new GlimmerScopedCSSWebpackPlugin(),
            new MonacoWebpackPlugin(),
            new webpack.ProvidePlugin({
              process: 'process',
            }),
            new webpack.IgnorePlugin({
              resourceRegExp: /^https:\/\/cardstack\.com\/base/,
            }),
            new MomentLocalesPlugin({
              // 'en' is built into moment and cannot be removed. This strips the others.
              localesToKeep: [],
            }),
          ],
          resolve: {
            fallback: {
              fs: false,
              os: false,
              path: require.resolve('path-browserify'),
              crypto: require.resolve('crypto-browserify'),
              stream: require.resolve('stream-browserify'),
              process: false,
            },
            alias: {
              'matrix-js-sdk': 'matrix-js-sdk/src/browser-index.ts', // Consume matrix-js-sdk via Typescript ESM so that code splitting works to exlcude massive matrix-sdk-crypto-wasm from the main bundle
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
