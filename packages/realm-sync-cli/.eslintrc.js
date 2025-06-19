module.exports = {
  root: true,
  extends: ['@cardstack/eslint-plugin-boxel/typescript'],
  env: {
    node: true,
  },
  parserOptions: {
    project: './tsconfig.json',
  },
  ignorePatterns: ['dist/', 'node_modules/'],
};
