'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');

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
            {
              test: /\.ts$/,
              exclude: /(node_modules)/,
              use: {
                loader: 'babel-loader',
                options: {
                  presets: [
                    [
                      '@babel/preset-env',
                      { targets: { browsers: ['last 1 Chrome versions'] } },
                    ],
                  ],
                  plugins: [
                    [
                      '@babel/plugin-transform-typescript',
                      { allowDeclareFields: true },
                    ],
                    '@babel/plugin-proposal-optional-chaining',
                    '@babel/plugin-proposal-nullish-coalescing-operator',
                    ['@babel/plugin-proposal-decorators', { legacy: true }],
                    [
                      '@babel/plugin-proposal-class-properties',
                      { loose: true },
                    ],
                  ],
                },
              },
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
