const path = require('path');
const webpack = require('webpack');

module.exports = {
  mode: process.env.PRODUCTION != null ? 'production' : 'development',
  entry: {
    worker: './src/main.ts',
  },
  target: 'webworker',
  devtool: process.env.PRODUCTION != null ? false : 'inline-source-map',
  plugins: [
    new webpack.ProvidePlugin({
      process: 'process',
      Buffer: 'buffer',
    }),
  ],
  module: {
    rules: [
      {
        test: /\.ts$/i,
        use: ['babel-loader'],
      },
    ],
  },
  output: {
    filename: '[name].js',
    path: path.resolve('../host/public'),
  },
  resolve: {
    extensions: ['.ts', '.js', '.json'],
    fallback: {
      fs: false,
      path: require.resolve('path-browserify'),
    },
    alias: {
      // this prevents complaining about require.extensions
      handlebars: 'handlebars/dist/cjs/handlebars.js',
    },
  },
  ignoreWarnings: [
    {
      // This utility can optionally accept a file path to your template
      // compiler and load it dynamically. We don't use that feature, so this
      // warning doesn't break for us.
      module:
        /vendor\/ember-template-imports\/lib\/preprocess-embedded-templates\.js$/,
      message: /the request of a dependency is an expression/,
    },
  ],
};
