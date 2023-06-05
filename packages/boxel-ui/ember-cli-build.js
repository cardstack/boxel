'use strict';
/* eslint-disable @typescript-eslint/no-var-requires */

const { Webpack } = require('@embroider/webpack');
const EmberAddon = require('ember-cli/lib/broccoli/ember-addon');
// eslint-disable-next-line node/no-missing-require
const { GlimmerScopedCSSWebpackPlugin } = require('glimmer-scoped-css/webpack');

// const { maybeEmbroider } = require('@embroider/test-setup');
// return maybeEmbroider(app);

module.exports = function (defaults) {
  const app = new EmberAddon(defaults, {
    vendorFiles: { 'jquery.js': null, 'app-shims.js': null },
  });

  return require('@embroider/compat').compatBuild(app, Webpack, {
    skipBabel: [
      {
        package: 'qunit',
      },
    ],
    extraPublicTrees: [],
    staticAddonTestSupportTrees: true,
    staticAddonTrees: true,
    // staticHelpers: true,
    // staticComponents: true,
    staticAppPaths: ['data'],
    packagerOptions: {
      publicAssetURL:
        process.env.DEPLOY_TARGET === 's3-preview' ||
        process.env.DEPLOY_TARGET === 'production'
          ? process.env.S3_PREVIEW_ASSET_BUCKET_ENDPOINT + '/'
          : undefined,
      webpackConfig: {
        module: {
          rules: [
            {
              test: /\.(png|jpg|gif|svg|woff|woff2|eot|ttf|otf|flac)$/i,
              loader: 'file-loader',
              options: {
                name: '[path][name]-[contenthash].[ext]',
              },
            },
          ],
        },
      },
      plugins: [new GlimmerScopedCSSWebpackPlugin()],
      resolveLoader: {
        alias: {
          'glimmer-scoped-css/virtual-loader': require.resolve(
            // eslint-disable-next-line node/no-missing-require
            'glimmer-scoped-css/virtual-loader'
          ),
        },
      },
      // publicAssetURL: '/boxel-ui/'
    },
  });
};
