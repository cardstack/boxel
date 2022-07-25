'use strict';

const EmberApp = require('ember-cli/lib/broccoli/ember-app');
const { compatBuild, V1Addon } = require('@embroider/compat');
const { Webpack } = require('@embroider/webpack');
const webpack = require('webpack');
const MonacoWebpackPlugin = require('monaco-editor-webpack-plugin');
const buildFunnel = require('broccoli-funnel');
const mergeTrees = require('broccoli-merge-trees');
const mapTrees = require('broccoli-stew').map;
const { resolve } = require('path');
let base = resolve('../base');

module.exports = function (defaults) {
  let app = new EmberApp(defaults, {
    trees: {
      app: mergeTrees([
        'app',
        mapTrees(
          buildFunnel(base, {
            destDir: 'lib',
            // don't copy over package.json or any other tooling file
            include: ['**/*.js', '**/*.ts', '**/*.gts', '**/*.gjs'],
          }),
          function (content) {
            // This is a simple workaround to replace the absolute module
            // imports with relative imports since webpack doesn't know how to
            // deal with the absolute imports (we use the webpack build of the
            // base card for the tests specifically). this doesn't take into
            // account the path of the consumer--assumes the consumer and dep
            // are in same dir.
            return content.replace(
              /from 'https:\/\/cardstack.com\/base\//g,
              "from './"
            );
            // The longer conversation is that we use absolute module imports in
            // the base cards so that the javascript symbols available in the
            // base card are able to "===" properly with cards that use these
            // symbols (e.g. primitive field cards). The challenge arises in our
            // service worker which performs fetch redirection from the
            // canonical base realm URL (https://cardstack.com/base/) to a
            // locally served base realm URL (http://localhost:4201/base/). As
            // modules are loaded from a module that has been redirected in such
            // a way, relative module imports from the module with the canonical
            // URL will actually load with a _different_ origin. This results in
            // javascript symbols that no longer "===" with one another even
            // though they seem to come from the same module, because depending
            // on who is asking for the base card module, the base card may
            // either come from the canonical URL or it may come from the
            // redirected URL. The symbols in the base card module from the
            // canonical URL are not "===" the same as the symbols in the base
            // card from the redirected URL. Hence, its important that there is
            // only one path that the browser can take to get to the base card
            // module--specifically the canonical URL route. So long as all
            // modules have an absolute URL reference to the base card, then
            // their inherited symbols will be "===" equivalent to the canonical
            // URL base card's symbols.
          }
        ),
      ]),
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
