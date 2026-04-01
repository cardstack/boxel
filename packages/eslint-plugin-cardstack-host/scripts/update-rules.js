'use strict';

const fs = require('fs');
const path = require('path');

function generate(filename, filter) {
  const root = path.resolve(__dirname, '../lib/rules');
  const recommendedRulesFile = path.resolve(__dirname, filename);

  const rules = fs
    .readdirSync(root)
    .filter((file) => path.extname(file) === '.js')
    .map((file) => path.basename(file, '.js'))
    .map((fileName) => [fileName, require(path.join(root, fileName))]);

  const recommendedRules = rules.reduce((obj, entry) => {
    const name = `cardstack-host/${entry[0]}`;
    if (filter(entry)) {
      obj[name] = 'error';
    }
    return obj;
  }, {});

  const recommendedRulesContent = `/*
 * IMPORTANT!
 * This file has been automatically generated.
 * In order to update its content based on rules'
 * definitions, execute "pnpm run update"
 */
module.exports = ${JSON.stringify(recommendedRules, null, 2)}`;

  fs.writeFileSync(recommendedRulesFile, recommendedRulesContent);
}

generate(
  '../lib/recommended-rules.js',
  (entry) => entry[1].meta.docs.recommended,
);
