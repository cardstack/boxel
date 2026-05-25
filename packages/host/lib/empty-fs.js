// Browser-side stub for Node's `fs`. recast's main.js eagerly requires `fs`
// but only uses it for the CLI runFile helper, which we never invoke in the
// browser. recast declares `"browser": { "fs": false }` in its package.json,
// but Rolldown doesn't honor the `browser` field, so we alias manually.
module.exports = {};
module.exports.default = {};
