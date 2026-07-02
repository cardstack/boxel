/** @type {import('eslint-doc-generator').GenerateOptions} */
const config = {
  pathRuleDoc: 'rules/{name}.md',
  ruleDocSectionInclude: ['Examples'],
  ruleDocTitleFormat: 'name',
};

module.exports = config;
