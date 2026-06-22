#!/usr/bin/env node
// Converts named imports from CommonJS packages that Node's static analyzer
// can't read named exports from, into default-import + destructure.
//
//   import { ensureDir, copy as cp } from 'fs-extra';
// becomes
//   import fsExtra from 'fs-extra';
//   const { ensureDir, copy: cp } = fsExtra;
//
// Works under both native Node ESM (default export is module.exports) and Vite.
//
// Usage: node cjs-named-to-default.mjs <file>...   (edits in place)
import { readFileSync, writeFileSync } from 'node:fs';

// Packages whose named exports Node cannot statically detect.
export const CJS_PACKAGES = {
  'fs-extra': 'fsExtra',
  debug: 'createDebug',
  qunit: 'QUnit',
  jsonwebtoken: 'jsonwebtoken',
};

function varName(pkg) {
  if (CJS_PACKAGES[pkg]) return CJS_PACKAGES[pkg];
  return pkg.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase());
}

export function transform(src) {
  let changed = false;
  let code = src;
  for (const pkg of Object.keys(CJS_PACKAGES)) {
    // Line-anchored so it only matches a real top-level import statement, never
    // an import that appears as test-fixture text inside a string/template
    // literal (those are preceded by a quote/backtick, so never start a line).
    const re = new RegExp(
      `^[ \\t]*import\\s*\\{([^}]*)\\}\\s*from\\s*(['"])${pkg.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&')}\\2;?[ \\t]*$`,
      'gm',
    );
    code = code.replace(re, (_full, names) => {
      const local = varName(pkg);
      const destructure = names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const m = s.match(/^(\w+)\s+as\s+(\w+)$/);
          return m ? `${m[1]}: ${m[2]}` : s;
        })
        .join(', ');
      changed = true;
      return `import ${local} from '${pkg}';\nconst { ${destructure} } = ${local};`;
    });
  }
  return { code, changed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let count = 0;
  for (const file of process.argv.slice(2)) {
    const { code, changed } = transform(readFileSync(file, 'utf8'));
    if (changed) {
      writeFileSync(file, code);
      count++;
    }
  }
  console.log(`cjs-named-to-default: ${count} file(s) changed`);
}
