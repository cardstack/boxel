// Hand-rolled ES → AMD transpiler for the Loader. Replaces babel's
// `transformAsync(src, { plugins: [[TransformModulesAmdPlugin, ...]] })`
// in `Loader.fetchModule`. ~15× faster than babel on real card sources
// (CS-10977; benchmarks in the ticket comment).
//
// Input contract: post-realm-server-transpiled JS — no TS, no JSX, no
// decorators (realm-server lowered all of that on the way in via
// `transpile.ts`). What's left is just static `import` / `export`
// declarations and `import.meta` references.
//
// Output: AMD `define(moduleId, [...deps], function (...args) { ... })`
// matching the loader's `define()` callback contract in `loader.ts`.
//
// Live-binding semantics:
//   - Imported names that are RE-EXPORTED (via `export { x } from 'foo'`,
//     `export * from 'foo'`, or `export { localName }` where `localName`
//     was bound by an `import` statement) are wired through getters that
//     read the dep arg every time, preserving ES module live-binding.
//   - Imported names that are USED IN SOURCE CODE are bound via top-level
//     `let` destructuring at the entry of the AMD body — a snapshot. This
//     differs from babel's plugin which inline-rewrites every reference
//     (`_foo.x`); for typical card code (immutable class/function/const
//     exports) the difference is unobservable, so we accept the gap for
//     ~15× speedup. If a future module relies on a mutable `export let`
//     being read live by importers AT CALL TIME inside a function, the
//     gap would surface. None of the existing tests hit this case.
import { Parser, type Program, type Node } from 'acorn';
import { simple as walkSimple } from 'acorn-walk';
import MagicString from 'magic-string';

interface AmdTranspileOptions {
  // The module identifier embedded in the emitted `define(...)` call.
  // Same role as the `moduleId` option to babel's TransformModulesAmd.
  moduleId: string;
}

// Sanitize a module specifier into something we can use as a JS identifier
// for the dep parameter name (collisions are still avoided by appending
// the dep index).
function sanitize(s: string): string {
  return '_' + String(s).replace(/[^a-zA-Z0-9_$]/g, '_');
}

// One imported binding: tells us how to read the live value back from the
// AMD dep argument. Used to wire up live-binding getters when the local
// name is also being re-exported.
type ImportedBinding =
  | { kind: 'default'; depArg: string }
  | { kind: 'namespace'; depArg: string }
  | { kind: 'named'; depArg: string; importedName: string };

export function transpileAmd(
  src: string,
  { moduleId }: AmdTranspileOptions,
): string {
  const ast = Parser.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowImportExportEverywhere: false,
    allowAwaitOutsideFunction: true,
  }) as Program;

  const ms = new MagicString(src);

  // AMD dep list and the matching factory parameter names. We always reserve
  // `exports` first; `__import_meta__` is appended at the end if used.
  const deps: string[] = ['exports'];
  const argNames: string[] = ['_exports'];

  // Local-name → how to read its live value. When `export { x }` re-exports
  // an imported name, we install a getter pointing at the dep.
  const importedBindings = new Map<string, ImportedBinding>();

  // Bindings to introduce at the top of the AMD body (snapshot via `let`).
  const bodyBindings: string[] = [];

  // Statements appended to the AMD body that define exports. Order matters:
  // function/class declarations stay in place in the source, so we install
  // their export setters AFTER the body so the names are bound by the time
  // setter runs.
  const exportStatements: string[] = [];

  // Track the names that this module exports locally; the `export *` filter
  // skips these so re-exported keys don't shadow our explicit exports.
  const localExportNames: string[] = [];

  // True if any `export *` is present. We register an `_exportNames` map
  // so the `export *` filter can skip explicit named exports.
  let hasExportStar = false;

  // Strip a top-level statement and its trailing newline if any.
  const stripStatement = (node: Node) => {
    let end = node.end;
    while (src[end] === ' ' || src[end] === '\t') end++;
    if (src[end] === '\n') end++;
    ms.remove(node.start, end);
  };

  for (const node of ast.body) {
    switch (node.type) {
      case 'ImportDeclaration': {
        const source = node.source.value as string;
        const argName = sanitize(source) + '$' + deps.length;
        deps.push(source);
        argNames.push(argName);

        const namedParts: string[] = [];
        for (const spec of node.specifiers) {
          if (spec.type === 'ImportDefaultSpecifier') {
            bodyBindings.push(`let ${spec.local.name} = ${argName}.default;`);
            importedBindings.set(spec.local.name, {
              kind: 'default',
              depArg: argName,
            });
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            bodyBindings.push(`let ${spec.local.name} = ${argName};`);
            importedBindings.set(spec.local.name, {
              kind: 'namespace',
              depArg: argName,
            });
          } else {
            // ImportSpecifier { imported, local, attributes }
            const importedName =
              spec.imported.type === 'Identifier'
                ? spec.imported.name
                : (spec.imported.value as string);
            namedParts.push(
              importedName === spec.local.name
                ? importedName
                : `${importedName}: ${spec.local.name}`,
            );
            importedBindings.set(spec.local.name, {
              kind: 'named',
              depArg: argName,
              importedName,
            });
          }
        }
        if (namedParts.length > 0) {
          bodyBindings.push(`let { ${namedParts.join(', ')} } = ${argName};`);
        }
        // If there are zero specifiers it's a side-effect-only import; the
        // dep is still listed so it gets loaded and evaluated.

        stripStatement(node);
        break;
      }

      case 'ExportNamedDeclaration': {
        if (node.declaration) {
          // export const X = ... | export function f() {...} | export class C {...}
          // Strip just the `export ` keyword + space; keep the declaration.
          const exportKwLen = 'export '.length;
          ms.remove(node.start, node.start + exportKwLen);
          const decl = node.declaration;
          if (decl.type === 'VariableDeclaration') {
            for (const d of decl.declarations) {
              if (d.id.type === 'Identifier') {
                exportStatements.push(`_exports.${d.id.name} = ${d.id.name};`);
                localExportNames.push(d.id.name);
              }
              // Top-level destructuring patterns aren't expected from the
              // realm-server transpile output; if we ever see one, the
              // transpile would silently drop the export — fail loudly:
              else {
                throw new Error(
                  `amd-transpile: unsupported destructuring pattern in top-level export at offset ${node.start}`,
                );
              }
            }
          } else if (
            decl.type === 'FunctionDeclaration' ||
            decl.type === 'ClassDeclaration'
          ) {
            const name = decl.id!.name;
            exportStatements.push(`_exports.${name} = ${name};`);
            localExportNames.push(name);
          }
        } else if (node.source) {
          // export { x, y as z } from 'foo';
          const source = node.source.value as string;
          const argName = sanitize(source) + '$' + deps.length;
          deps.push(source);
          argNames.push(argName);
          for (const spec of node.specifiers) {
            const localName =
              spec.local.type === 'Identifier'
                ? spec.local.name
                : (spec.local.value as string);
            const exportedName =
              spec.exported.type === 'Identifier'
                ? spec.exported.name
                : (spec.exported.value as string);
            exportStatements.push(
              defineGetter(exportedName, `${argName}.${localName}`),
            );
            localExportNames.push(exportedName);
          }
          stripStatement(node);
        } else {
          // export { x, y as z };  — local re-export. If the local was
          // imported, install a getter for live-binding through the dep
          // arg; otherwise, simple assignment is fine (matches babel for
          // mutable `let` exports too — same fidelity).
          for (const spec of node.specifiers) {
            const localName =
              spec.local.type === 'Identifier'
                ? spec.local.name
                : (spec.local.value as string);
            const exportedName =
              spec.exported.type === 'Identifier'
                ? spec.exported.name
                : (spec.exported.value as string);
            const importBinding = importedBindings.get(localName);
            if (importBinding) {
              const depRead = readImportedBinding(importBinding);
              exportStatements.push(defineGetter(exportedName, depRead));
            } else {
              exportStatements.push(`_exports.${exportedName} = ${localName};`);
            }
            localExportNames.push(exportedName);
          }
          stripStatement(node);
        }
        break;
      }

      case 'ExportDefaultDeclaration': {
        const decl = node.declaration;
        localExportNames.push('default');
        if (
          decl.type === 'FunctionDeclaration' ||
          decl.type === 'ClassDeclaration'
        ) {
          if (decl.id) {
            // Strip `export default ` keeping the named declaration.
            ms.remove(node.start, decl.start);
            exportStatements.push(`_exports.default = ${decl.id.name};`);
          } else {
            // Anonymous function/class — turn into a const decl.
            const declSrc = src.slice(decl.start, decl.end);
            ms.overwrite(
              node.start,
              node.end,
              `const _default = ${declSrc};\n_exports.default = _default;`,
            );
          }
        } else {
          // export default <expression>;
          const exprSrc = src.slice(decl.start, decl.end);
          ms.overwrite(node.start, node.end, `_exports.default = ${exprSrc};`);
        }
        break;
      }

      case 'ExportAllDeclaration': {
        // export * from 'foo';   |   export * as ns from 'foo';
        const source = node.source.value as string;
        const argName = sanitize(source) + '$' + deps.length;
        deps.push(source);
        argNames.push(argName);
        if (node.exported) {
          // export * as ns from 'foo' — namespace export.
          const exportedName =
            node.exported.type === 'Identifier'
              ? node.exported.name
              : (node.exported.value as string);
          exportStatements.push(defineGetter(exportedName, argName));
          localExportNames.push(exportedName);
        } else {
          hasExportStar = true;
          exportStatements.push(reExportStarSnippet(argName));
        }
        stripStatement(node);
        break;
      }

      default:
        // Other top-level node — leave alone.
        break;
    }
  }

  // Replace `import.meta` references using AST positions (not regex), so we
  // never touch occurrences inside string literals / comments.
  let usesImportMeta = false;
  walkSimple(ast, {
    MetaProperty(node: any) {
      if (
        node.meta &&
        node.meta.name === 'import' &&
        node.property &&
        node.property.name === 'meta'
      ) {
        usesImportMeta = true;
        ms.overwrite(node.start, node.end, '__import_meta__');
      }
    },
  });
  if (usesImportMeta) {
    deps.push('__import_meta__');
    argNames.push('__import_meta__');
  }

  // Compose the AMD wrapper.
  const headerLines: string[] = [
    `define(${JSON.stringify(moduleId)}, ${JSON.stringify(deps)}, function (${argNames.join(', ')}) {`,
    `  "use strict";`,
    `  Object.defineProperty(_exports, "__esModule", { value: true });`,
  ];

  if (hasExportStar) {
    // The filter set is consulted by the export-* snippet below to skip any
    // names that this module declares explicitly.
    headerLines.push(
      `  var _exportNames = ${JSON.stringify(
        Object.fromEntries(localExportNames.map((n) => [n, true])),
      )};`,
    );
  }

  if (bodyBindings.length > 0) {
    headerLines.push(...bodyBindings.map((b) => '  ' + b));
  }

  ms.prepend(headerLines.join('\n') + '\n');
  ms.append(
    '\n' + exportStatements.map((s) => '  ' + s).join('\n') + '\n});\n',
  );

  return ms.toString();
}

function defineGetter(exportedName: string, expr: string): string {
  return `Object.defineProperty(_exports, ${JSON.stringify(exportedName)}, { enumerable: true, get: function () { return ${expr}; } });`;
}

function readImportedBinding(b: ImportedBinding): string {
  switch (b.kind) {
    case 'default':
      return `${b.depArg}.default`;
    case 'namespace':
      return b.depArg;
    case 'named':
      return `${b.depArg}.${b.importedName}`;
  }
}

// Emitted as a single statement in the AMD body for `export * from 'foo'`.
// Walks the dep's keys and installs a getter per key, skipping `default`,
// `__esModule`, and any name this module declares explicitly (filtered via
// `_exportNames` which the wrapper installs at the top of the body).
function reExportStarSnippet(argName: string): string {
  return (
    `Object.keys(${argName}).forEach(function (key) { ` +
    `if (key === "default" || key === "__esModule") return; ` +
    `if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return; ` +
    `if (key in _exports && _exports[key] === ${argName}[key]) return; ` +
    `Object.defineProperty(_exports, key, { enumerable: true, get: function () { return ${argName}[key]; } }); ` +
    `});`
  );
}
