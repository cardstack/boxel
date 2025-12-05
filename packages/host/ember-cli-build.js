'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const MomentLocalesPlugin = require('moment-locales-webpack-plugin');
const { GlimmerScopedCSSWebpackPlugin } = require('glimmer-scoped-css/webpack');
const withSideWatch = require('./lib/with-side-watch');
const Funnel = require('broccoli-funnel');
const { BoxelUIChecksumPlugin } = require('./lib/build/package-dist-checksums');

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
        [require.resolve('decorator-transforms')],
        require.resolve('ember-concurrency/async-arrow-task-transform'),
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
    extraPublicTrees: [
      new Funnel('node_modules/content-tag/pkg', {
        include: ['standalone.js', 'standalone/*'],
        destDir: 'assets/content-tag',
      }),
    ],
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
            // boxel-ui packages dist checksum needed for the realm server to figure out if boxel-ui changed, and trigger a reindex of cards that use it (to update cards' prerendered HTML)
            new BoxelUIChecksumPlugin(__dirname),
          ],
          externals: {
            'content-tag': 'ContentTagGlobal',
          },
          resolve: {
            fallback: {
              fs: false,
              os: false,
              path: require.resolve('path-browserify'),
              crypto: require.resolve('crypto-browserify'),
              stream: require.resolve('stream-browserify'),
            },
            alias: {
              // Exclude the rust-crypto module from the bundle because we don't use it
              'matrix-js-sdk$': 'matrix-js-sdk/src/browser-index.ts',
              './rust-crypto/index.ts': false,
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
