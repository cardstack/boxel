'use strict';

const fs = require('fs');
const path = require('path');

const rules = generateRulesMap();

module.exports = {
  configs: {
    recommended: generateRecommendedConfig(rules),
  },
  rules,
};

function generateRulesMap() {
  let rulesPath = path.join(__dirname, 'rules');
  let files = fs.readdirSync(rulesPath);

  let rulesMap = {};
  for (let file of files) {
    if (file.endsWith('.js') && !file.endsWith('.test.js')) {
      let ruleName = path.parse(file).name;
      rulesMap[ruleName] = require(`./rules/${file}`);
    }
  }
  return rulesMap;
}

function generateRecommendedConfig(rules) {
  let config = {
    plugins: ['qunit-dom'],
    rules: {},
  };

  for (let ruleName of Object.keys(rules)) {
    let rule = rules[ruleName];
    if (rule.meta.docs.recommended) {
      config.rules[`qunit-dom/${ruleName}`] = 'error';
    }
  }

  return config;
}
