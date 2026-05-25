// Pure utilities for emitting AMD-wrapper text. No AST awareness, just
// string formatting + escaping rules.

// Sanitize a module specifier into something usable as a JS identifier
// for the dep parameter name. Collisions are still avoided by appending
// the dep index, so `_foo$1` and `_foo$2` cannot collide.
export function sanitize(s: string): string {
  return '_' + String(s).replace(/[^a-zA-Z0-9_$]/g, '_');
}

// True if the given exported/imported name is a legal identifier (so we
// can emit `_exports.x = ...`); false means we must use bracket notation
// (`_exports['weird name'] = ...`).
export function isIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

export function memberAccess(obj: string, prop: string): string {
  return isIdentifier(prop)
    ? `${obj}.${prop}`
    : `${obj}[${JSON.stringify(prop)}]`;
}

export function exportLValue(name: string): string {
  return memberAccess('_exports', name);
}

export function defineGetter(exportedName: string, expr: string): string {
  return `Object.defineProperty(_exports, ${JSON.stringify(exportedName)}, { enumerable: true, configurable: true, get: function () { return ${expr}; } });`;
}

// Used for mutable local exports (`export let X` etc.). The getter reads
// the local binding by name at access time, so mutations to `name`
// (e.g. `counter++` inside an exported function) propagate to importers.
// The local stays in the AMD body's lexical scope, so the getter's
// closure can see it.
export function defineLocalGetter(name: string): string {
  return `Object.defineProperty(_exports, ${JSON.stringify(
    name,
  )}, { enumerable: true, configurable: true, get: function () { return ${name}; } });`;
}

// `export * from 'foo'` — install a getter for every key on the dep that
// isn't `default`/`__esModule` and isn't an explicit name on this module.
// The `_exportNames` set is consulted so re-exported keys can't shadow
// names this module declares directly.
export function reExportStarSnippet(argName: string): string {
  return (
    `Object.keys(${argName}).forEach(function (key) { ` +
    `if (key === "default" || key === "__esModule") return; ` +
    `if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return; ` +
    `if (key in _exports && _exports[key] === ${argName}[key]) return; ` +
    `Object.defineProperty(_exports, key, { enumerable: true, configurable: true, get: function () { return ${argName}[key]; } }); ` +
    `});`
  );
}
