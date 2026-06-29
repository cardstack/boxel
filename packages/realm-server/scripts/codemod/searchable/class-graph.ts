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

  let handleClass = (decl: any, exportName: string | null) => {
    if (decl?.type !== 'ClassDeclaration') return;
    let className: string | null = decl.id?.name ?? null;
    // Key by EXPORT name — that's what `boxel_index.types[0]` / `adoptsFrom`
    // record. A default-exported card def is `<module>/default` in the DB even
    // when the class has a local name, and an anonymous default export has no
    // class name at all. Fall back to the class name for non-exported / local
    // classes referenced by name.
    let keyName = exportName ?? className;
    if (!keyName) return;
    let relKey = `${mod.modPath}/${keyName}`;
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

    let node: ClassNode = {
      relKey,
      className: className ?? keyName,
      modPath: mod.modPath,
      fields,
    };
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
    // Also register under the local class name so same-realm `extends`/field
    // refs that name a default-exported class resolve. The export-name key is
    // the canonical one (matches the DB); the alias just aids local resolution.
    if (className && className !== keyName) {
      graph.set(`${mod.modPath}/${className}`, node);
    }
  };

  for (let node of ast.program.body) {
    if (node.type === 'ExportNamedDeclaration' && node.declaration)
      handleClass(node.declaration, node.declaration.id?.name ?? null);
    else if (node.type === 'ExportDefaultDeclaration' && node.declaration)
      handleClass(node.declaration, 'default');
    else handleClass(node, node.id?.name ?? null);
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

// Does `relKey`'s extends chain terminate at the platform card root (CardDef)?
// Used to scope zero-instance defaulting to instantiable card defs (a FieldDef
// is never a top-level instance, so defaulting its links would be inert noise).
// A chain that exits to FieldDef/BaseDef, or that we can't resolve, is not a
// card def.
export function isCardDef(
  graph: Map<string, ClassNode>,
  relKey: string,
): boolean {
  let seen = new Set<string>();
  let cur: string | undefined = relKey;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    let node = graph.get(cur);
    if (!node) return false;
    if (node.superRelKey) {
      cur = node.superRelKey;
      continue;
    }
    return node.externalName === 'CardDef';
  }
  return false;
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

export type PruneReason =
  | 'polymorphic'
  | 'unresolved'
  | 'unvalidated'
  | 'contains-self';

const CONTAINS_FNS = new Set(['contains', 'containsMany']);

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
  let reason: PruneReason | undefined;
  for (let i = 0; i < segments.length; i++) {
    let seg = segments[i];
    if (!curType) {
      // The previous segment's target type isn't in the loaded source (a
      // cross-realm concrete type we can't see). Don't guess it's bloat —
      // KEEP the rest of the route to preserve parity, and flag for review.
      // Only CONFIRMED polymorphic / non-declared segments are ever pruned.
      for (let j = i; j < segments.length; j++) kept.push(segments[j]);
      reason = 'unvalidated';
      break;
    }
    let fi = fieldInfoOf(graph, curType, seg);
    if (!fi) {
      // `curType` IS a loaded class but doesn't declare `seg` → subtype bloat.
      reason = 'unresolved';
      break;
    }
    if (fi.polymorphic) {
      reason = 'polymorphic';
      break;
    }
    kept.push(seg);
    curType =
      fi.targetRelKey && graph.has(fi.targetRelKey)
        ? fi.targetRelKey
        : undefined;
  }
  // A bare-self route on a contains/containsMany field is inert: contained
  // values are always in the search doc, so `searchable` on such a field only
  // means something via a DEEPER route (a tail). A route that is (or truncated
  // down to) just the bare contains field is the schema-free derivation
  // mistaking a contained composite that carries an `id`-named field for a
  // link — drop it. Checked at every exit (a deeper route can truncate here).
  if (kept.length === 1) {
    let headFi = fieldInfoOf(graph, rootRelKey, kept[0]);
    if (headFi && CONTAINS_FNS.has(headFi.fieldType)) {
      return { kept: null, reason: 'contains-self' };
    }
  }
  return { kept: kept.length ? kept.join('.') : null, reason };
}
