'use strict';

const prettier = require('prettier');

/** @type {import('eslint-doc-generator').GenerateOptions} */
module.exports = {
  // The repo-wide pre-commit hook runs prettier over generated docs, so the
  // generator must emit prettier-formatted output or the "generated files are
  // up to date" CI check can never match the committed files.
  postprocess: async (content, path) =>
    prettier.format(content, {
      ...(await prettier.resolveConfig(path)),
      parser: 'markdown',
    }),
};
