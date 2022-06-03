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

    compatAdapters: new Map([
      [
        'ember-template-imports',
        // We need to do a slightly awkward thing here: ember-template-imports
        // is a v1 addon, but it contains some *node* code that we want to run
        // *in the ember app*.
        //
        // None of that code will be reflected in the rewritten v2 addon
        // produced by embroider by default, so we need to manually include
        // lib/**.
        //
        // We also need to mark this resulting package as not-an-ember-addon
        // because otherwise the require() calls inside it would get rewritten
        // by embroider to window.require, which makes webpack not find them.
        class extends V1Addon {
          get newPackageJSON() {
            let pkgJSON = super.newPackageJSON;
            pkgJSON.keywords = pkgJSON.keywords.filter(
              (k) => k !== 'ember-addon'
            );
            return pkgJSON;
          }
          get v2Tree() {
            return mergeTrees([
              super.v2Tree,
              buildFunnel(this.rootTree, { include: ['lib/**'] }),
            ]);
          }
        },
      ],
    ]),

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
