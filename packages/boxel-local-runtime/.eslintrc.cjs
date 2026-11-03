module.exports = {
  env: { node: true, es2022: true },
  parserOptions: { ecmaVersion: 'latest' },
  globals: {
    fetch: 'readonly',
    Headers: 'readonly',
    Request: 'readonly',
    Response: 'readonly',
    AbortController: 'readonly',
    AbortSignal: 'readonly',
    structuredClone: 'readonly',
  },
};
