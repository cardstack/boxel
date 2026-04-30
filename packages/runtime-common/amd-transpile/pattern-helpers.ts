// Pure AST helpers shared between the main transpile pass (used to
// collect names declared at module top level + names introduced by
// destructured exports) and the IdentifierRewriter (used to track
// scope membership during the rewrite walk). Neither is aware of
// magic-string or AMD-specifics — they're language-level.
import type { AnyNode, Pattern } from 'acorn';

// Walk a binding pattern (the LHS of a `let`/`const`/`var`/parameter/
// destructured-assignment) and call `cb` for every Identifier name bound
// by the pattern. Note that `MemberExpression` can appear as a pattern
// in destructure-assignment (`[obj.x] = arr`) but binds no new name —
// nothing to do in that case.
export function collectPatternBindings(
  pattern: Pattern | null | undefined,
  cb: (name: string) => void,
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      cb(pattern.name);
      break;
    case 'ObjectPattern':
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement') {
          collectPatternBindings(prop.argument, cb);
        } else {
          collectPatternBindings(prop.value as Pattern, cb);
        }
      }
      break;
    case 'ArrayPattern':
      for (const el of pattern.elements) {
        if (el) collectPatternBindings(el, cb);
      }
      break;
    case 'AssignmentPattern':
      collectPatternBindings(pattern.left, cb);
      break;
    case 'RestElement':
      collectPatternBindings(pattern.argument, cb);
      break;
  }
}

// Returns true iff an Identifier at the given position is a value
// reference (not a binding LHS, property key, or label). Drives whether
// the IdentifierRewriter should rewrite the identifier to a dep-arg
// access.
export function isReferencePosition(
  parent: AnyNode | null,
  parentKey: string,
  parentArrayKey: string | null,
): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case 'MemberExpression':
      if (parentKey === 'property' && !parent.computed) return false;
      return true;
    case 'Property':
      if (parentKey === 'key' && !parent.computed && !parent.shorthand) {
        return false;
      }
      return true;
    case 'MethodDefinition':
    case 'PropertyDefinition':
      if (parentKey === 'key' && !parent.computed) return false;
      return true;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      if (parentKey === 'label') return false;
      return true;
    case 'ImportSpecifier':
    case 'ImportDefaultSpecifier':
    case 'ImportNamespaceSpecifier':
      return false;
    case 'ExportSpecifier':
      return false;
    case 'VariableDeclarator':
      if (parentKey === 'id') return false;
      return true;
    case 'FunctionDeclaration':
    case 'FunctionExpression':
    case 'ClassDeclaration':
    case 'ClassExpression':
    case 'ArrowFunctionExpression':
      if (parentKey === 'id') return false;
      if (parentArrayKey === 'params') return false;
      return true;
    case 'CatchClause':
      if (parentKey === 'param') return false;
      return true;
    case 'AssignmentPattern':
      if (parentKey === 'left') return false;
      return true;
    case 'RestElement':
      if (parentKey === 'argument') return false;
      return true;
    case 'ObjectPattern':
    case 'ArrayPattern':
      return false;
    default:
      return true;
  }
}
