// Resolves the card/field class hierarchy AND field target types across a
// realm's source (optionally plus base / other realms loaded for type
// resolution only). Two jobs:
//
//   1. HOIST an observed route to the class that declares its head field
//      (`Customer extends Contact` exposes `crmApp`, declared on `Contact`).
//   2. PRUNE a route against the declared types: a route segment that crosses a
//      POLYMORPHIC field (`linksTo(CardDef)` / `containsMany(FieldDef)`) or a
//      field the declared type doesn't have (subtype bloat) is dropped from
//      that point on. Polymorphic relationships can't be spelled in a query or
//      compiled to SQL — they're unsearchable search-doc cruft — so dropping
//      them is correct and shrinks the doc.
//
// Parses like the rewriter (gjsToPlaceholderJS → @babel) but only reads.

import { parse as babelParse } from '@babel/parser';
import { gjsToPlaceholderJS } from '@cardstack/runtime-common/module-syntax';
import { getBabelOptions } from '@cardstack/runtime-common/babel-options';

const FIELD_FNS = new Set([
  'contains',
  'containsMany',
  'linksTo',
  'linksToMany',
]);
// The polymorphic root types: a relationship to one of these can hold any
// card/field, so the query layer can't resolve a path through it.
const POLYMORPHIC_ROOTS = new Set(['CardDef', 'FieldDef', 'BaseDef']);

export interface FieldInfo {
  name: string;
  fieldType: string; // contains | containsMany | linksTo | linksToMany
  // Resolved target type, as far as possible:
  targetName?: string; // the type identifier (e.g. 'Author', 'CardDef')
  targetRelKey?: string; // in-graph relKey of the target type, if resolvable
  polymorphic: boolean; // target is a polymorphic root (CardDef/FieldDef/BaseDef)
}

export interface ClassNode {
  relKey: string;
  className: string;
  modPath: string;
  fields: Map<string, FieldInfo>;
  superRelKey?: string;
  externalName?: string;
}

export interface SourceModule {
  modPath: string; // realm-relative, no extension (e.g. `crm/customer`)
  filename: string;
  source: string;
}

function propKeyName(node: any): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  return null;
}

function resolveRelative(
  fromModPath: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith('.')) return null;
  let spec = specifier.replace(/\.(gts|ts)$/, '');
  let fromDir = fromModPath.includes('/')
    ? fromModPath.slice(0, fromModPath.lastIndexOf('/'))
    : '';
  let segs = fromDir ? fromDir.split('/') : [];
  for (let part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return segs.join('/');
}

// The identifier naming a type in `extends X` or `linksTo(X)` — unwrap a thunk
// (`() => X`) and member access (`Mod.X` → `X`).
function typeIdentifier(node: any): string | null {
  if (!node) return null;
  if (node.type === 'ArrowFunctionExpression') return typeIdentifier(node.body);
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression') return propKeyName(node.property);
  return null;
}

interface ImportMap {
  get(local: string): { specifier: string; importedName: string } | undefined;
}

// Resolve a type identifier to a graph relKey (in-realm/loaded) or just a name.
function resolveTypeRef(
  name: string | null,
  imports: ImportMap,
  localClassNames: Set<string>,
  modPath: string,
): { targetName?: string; targetRelKey?: string } {
  if (!name) return {};
  let imp = imports.get(name);
  if (imp) {
    let rel = resolveRelative(modPath, imp.specifier);
    if (rel != null) {
      return {
        targetName: imp.importedName,
        targetRelKey: `${rel}/${imp.importedName}`,
      };
    }
    return { targetName: imp.importedName }; // external (base / package / other realm)
  }
  if (localClassNames.has(name)) {
    return { targetName: name, targetRelKey: `${modPath}/${name}` };
  }
  return { targetName: name };
}

function analyzeModule(mod: SourceModule, graph: Map<string, ClassNode>): void {
  let ast: any;
  try {
    ast = babelParse(
      gjsToPlaceholderJS(mod.source),
      getBabelOptions({ sourceFilename: mod.filename }),
    );
  } catch {
    return;
  }

  let imports = new Map<string, { specifier: string; importedName: string }>();
  let localClassNames = new Set<string>();
  for (let node of ast.program.body) {
    if (node.type === 'ImportDeclaration') {
      let specifier = node.source.value;
      for (let s of node.specifiers) {
        if (s.type === 'ImportSpecifier') {
          imports.set(s.local.name, {
            specifier,
            importedName: propKeyName(s.imported) ?? s.local.name,
          });
        } else if (s.type === 'ImportDefaultSpecifier') {
          imports.set(s.local.name, { specifier, importedName: 'default' });
        }
      }
    }
  }
  let collectClassNames = (decl: any) => {
    if (decl?.type === 'ClassDeclaration' && decl.id?.name) {
      localClassNames.add(decl.id.name);
    }
  };
  for (let node of ast.program.body) {
    collectClassNames(
      node.type === 'ExportNamedDeclaration' ? node.declaration : node,
    );
    if (node.type === 'ExportDefaultDeclaration')
      collectClassNames(node.declaration);
  }

  let handleClass = (decl: any) => {
    if (decl?.type !== 'ClassDeclaration' || !decl.id?.name) return;
    let className = decl.id.name;
    let relKey = `${mod.modPath}/${className}`;
    let fields = new Map<string, FieldInfo>();
    for (let m of decl.body?.body ?? []) {
      if (m.type !== 'ClassProperty' && m.type !== 'PropertyDefinition')
        continue;
      let call = m.value;
      if (
        call?.type !== 'CallExpression' ||
        call.callee?.type !== 'Identifier' ||
        !FIELD_FNS.has(call.callee.name)
      ) {
        continue;
      }
      let name = propKeyName(m.key);
      if (!name) continue;
      let targetIdent = typeIdentifier(call.arguments[0]);
      let { targetName, targetRelKey } = resolveTypeRef(
        targetIdent,
        imports,
        localClassNames,
        mod.modPath,
      );
      fields.set(name, {
        name,
        fieldType: call.callee.name,
        targetName,
        targetRelKey,
        polymorphic: targetName != null && POLYMORPHIC_ROOTS.has(targetName),
      });
    }

    let node: ClassNode = { relKey, className, modPath: mod.modPath, fields };
    let supIdent = typeIdentifier(decl.superClass);
    if (
      decl.superClass?.type === 'Identifier' ||
      decl.superClass?.type === 'ArrowFunctionExpression'
    ) {
      let { targetName, targetRelKey } = resolveTypeRef(
        supIdent,
        imports,
        localClassNames,
        mod.modPath,
      );
      if (targetRelKey) node.superRelKey = targetRelKey;
      else if (targetName) node.externalName = targetName;
    } else if (decl.superClass) {
      node.externalName = '(computed)';
    }
    graph.set(relKey, node);
  };

  for (let node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration)
      handleClass(node.declaration);
    else if (node.type === 'ExportDefaultDeclaration' && node.declaration)
      handleClass(node.declaration);
    else handleClass(node);
  }
}

export function buildClassGraph(
  modules: SourceModule[],
): Map<string, ClassNode> {
  let graph = new Map<string, ClassNode>();
  for (let mod of modules) analyzeModule(mod, graph);
  return graph;
}

export type DeclaringResult =
  | { kind: 'local'; relKey: string }
  | { kind: 'external'; externalName: string }
  | { kind: 'unknown' };

export function findDeclaringClass(
  graph: Map<string, ClassNode>,
  leafRelKey: string,
  fieldName: string,
): DeclaringResult {
  let seen = new Set<string>();
  let cur: string | undefined = leafRelKey;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    let node = graph.get(cur);
    if (!node) return { kind: 'unknown' };
    if (node.fields.has(fieldName)) return { kind: 'local', relKey: cur };
    if (node.superRelKey) {
      cur = node.superRelKey;
      continue;
    }
    if (node.externalName)
      return { kind: 'external', externalName: node.externalName };
    return { kind: 'unknown' };
  }
  return { kind: 'unknown' };
}

// FieldInfo for `fieldName` on `classRelKey`, walking up the extends chain.
function fieldInfoOf(
  graph: Map<string, ClassNode>,
  classRelKey: string,
  fieldName: string,
): FieldInfo | undefined {
  let decl = findDeclaringClass(graph, classRelKey, fieldName);
  if (decl.kind !== 'local') return undefined;
  return graph.get(decl.relKey)!.fields.get(fieldName);
}

export type PruneReason = 'polymorphic' | 'unresolved' | 'unvalidated';

export interface PruneResult {
  kept: string | null; // the valid prefix route, or null if nothing survives
  reason?: PruneReason; // why it was truncated (absent if fully kept)
}

// Validate a route (rooted at `rootRelKey`'s field) against declared types,
// truncating at the first segment that crosses a polymorphic field or isn't
// declared on the current type. `rootRelKey` declares segment[0].
export function pruneRoute(
  graph: Map<string, ClassNode>,
  rootRelKey: string,
  route: string,
): PruneResult {
  let segments = route.split('.');
  let curType: string | undefined = rootRelKey;
  let kept: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];
    if (!curType) {
      // The previous segment's target type isn't in the loaded source (a
      // cross-realm concrete type we can't see). Don't guess it's bloat —
      // KEEP the rest of the route to preserve parity, and flag for review.
      // Only CONFIRMED polymorphic / non-declared segments are ever pruned.
      for (let j = i; j < segments.length; j++) kept.push(segments[j]);
      return { kept: kept.join('.'), reason: 'unvalidated' };
    }
    let fi = fieldInfoOf(graph, curType, seg);
    if (!fi) {
      // `curType` IS a loaded class but doesn't declare `seg` → subtype bloat.
      return {
        kept: kept.length ? kept.join('.') : null,
        reason: 'unresolved',
      };
    }
    if (fi.polymorphic) {
      return {
        kept: kept.length ? kept.join('.') : null,
        reason: 'polymorphic',
      };
    }
    kept.push(seg);
    curType =
      fi.targetRelKey && graph.has(fi.targetRelKey)
        ? fi.targetRelKey
        : undefined;
  }
  return { kept: kept.join('.') };
}
