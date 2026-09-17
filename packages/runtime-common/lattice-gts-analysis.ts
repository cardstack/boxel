import { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import { bxl, getBxlComputeDefinition, type BxlOptions } from '@cardstack/bxl';
import { computeContentHash } from './content-hash.ts';
import {
  ModuleSyntax,
  type PossibleCardOrFieldDeclaration,
} from './module-syntax.ts';
import type { ClassReference } from './schema-analysis-plugin.ts';
import { VirtualNetwork } from './virtual-network.ts';
import type { BxlComputeDefinition } from '@cardstack/bxl';
import {
  LATTICE_GTS_ANALYZER_REVISION,
  LATTICE_GTS_DATA_REVISION_ALGORITHM,
  type LatticeGtsAnalysis,
  type LatticeGtsDiagnostic,
  type LatticeGtsExportAnalysis,
} from './lattice-gts-analysis-contract.ts';
export * from './lattice-gts-analysis-contract.ts';

// This entry is loaded only by analysis producers, not the runtime barrel.
// Parsing and official BXL preparation execute trusted compiler code. No source
// module, imported module, constructor, getter or computeVia is evaluated.
export function analyzeLatticeGtsSource(
  fileId: string,
  source: string,
): LatticeGtsAnalysis {
  const sourceBytes = new TextEncoder().encode(source);
  const result: LatticeGtsAnalysis = {
    version: 1,
    coverage: 'local-syntax',
    analyzerRevision: LATTICE_GTS_ANALYZER_REVISION,
    fileId,
    sourceRevision: {
      algorithm: 'boxel-content-hash-utf8-v1',
      digest: computeContentHash(sourceBytes),
    },
    state: 'analyzed',
    imports: [],
    exports: [],
    exportStars: [],
    localDefinitions: [],
    diagnostics: [],
  };
  if (sourceBytes.byteLength > 1_048_576) {
    result.state = 'blocked';
    result.diagnostics.push({
      code: 'analysis-size-limit',
      message: 'Source exceeds the 1 MiB analysis budget',
    });
    return result;
  }
  try {
    const syntax = new ModuleSyntax(
      source,
      new URL(fileId),
      new VirtualNetwork(),
    );
    const program = syntax.program;
    for (const statement of program.body) {
      if (t.isImportDeclaration(statement)) {
        result.imports.push({
          module: statement.source.value,
          kind: 'import',
          typeOnly:
            statement.importKind === 'type' ||
            (statement.specifiers.length > 0 &&
              statement.specifiers.every(
                (item) =>
                  t.isImportSpecifier(item) && item.importKind === 'type',
              )),
        });
      } else if (
        (t.isExportNamedDeclaration(statement) ||
          t.isExportAllDeclaration(statement)) &&
        statement.source
      ) {
        result.imports.push({
          module: statement.source.value,
          kind: 'reexport',
          typeOnly:
            statement.exportKind === 'type' ||
            (t.isExportNamedDeclaration(statement) &&
              statement.specifiers.length > 0 &&
              statement.specifiers.every(
                (item) =>
                  t.isExportSpecifier(item) && item.exportKind === 'type',
              )),
        });
        if (
          t.isExportAllDeclaration(statement) &&
          statement.exportKind !== 'type'
        )
          result.exportStars.push(statement.source.value);
      }
    }
    const moduleReasons = moduleDiagnostics(
      program,
      syntax.possibleCardsOrFields[0]?.path,
    );
    if (source.includes('templatePlaceholder'))
      moduleReasons.push({
        code: 'reserved-analysis-identifier',
        message:
          'Authored templatePlaceholder identifier cannot be confused with preprocessor output',
      });
    // Import-only and re-export-only files can also have module effects.
    result.diagnostics.push(...moduleReasons);
    if (syntax.possibleCardsOrFields.length > 128) {
      result.state = 'blocked';
      result.diagnostics.push({
        code: 'analysis-declaration-limit',
        message: 'Module exceeds 128 local class declarations',
      });
      return result;
    }
    result.localDefinitions = syntax.possibleCardsOrFields.map((declaration) =>
      analyzeClass(declaration, moduleReasons),
    );
    for (const declaration of syntax.declarations) {
      if (!declaration.exportName) continue;
      // The schema analyzer also reports aliases and erased type exports.
      // Emit aliases from the actual value export syntax below, once each.
      if (declaration.type === 'reexport') continue;
      if (!t.isExportDeclaration(declaration.path.parentPath?.node)) continue;
      if (result.exports.length >= 128) {
        result.state = 'blocked';
        result.diagnostics.push({
          code: 'analysis-export-limit',
          message: 'Module exceeds 128 exported declarations',
        });
        break;
      }
      if (declaration.type === 'possibleCardOrField') {
        result.exports.push(analyzeClass(declaration, moduleReasons));
      } else {
        result.exports.push({
          name: declaration.exportName,
          ...(declaration.localName
            ? { localName: declaration.localName }
            : {}),
          indexing: 'chrome-data',
          fields: [],
          reasons: [
            {
              code: 'not-a-declarative-card',
              message: 'No supported declarative card plan was established',
            },
          ],
        });
      }
    }
    captureExportTargets(result, syntax);
    if (
      result.state === 'analyzed' &&
      !source.includes('templatePlaceholder')
    ) {
      result.dataRevision = {
        algorithm: LATTICE_GTS_DATA_REVISION_ALGORITHM,
        digest: dataProgramDigest(program),
      };
    }
  } catch (error) {
    result.state = 'blocked';
    result.exports = [];
    result.localDefinitions = [];
    result.diagnostics.push({
      code: 'source-analysis-error',
      message: String((error as Error).message).slice(0, 1000),
    });
  }
  return result;
}

// Preserve every authored import, initializer, constructor, helper and query.
// Only preprocessor-owned template contents and nonsemantic parser metadata
// are excluded. This intentionally over-invalidates on presentation JS edits;
// proving a smaller dependency closure belongs to linking/admission.
function dataProgramDigest(program: t.Program): string {
  const dataProgram = t.cloneNode(program, true, true);
  t.traverseFast(dataProgram, (node) => {
    if (
      t.isCallExpression(node) &&
      t.isIdentifier(node.callee, { name: 'templatePlaceholder' })
    ) {
      node.arguments = [];
    }
  });
  const metadata = new Set([
    'start',
    'end',
    'loc',
    'extra',
    'leadingComments',
    'innerComments',
    'trailingComments',
    'comments',
    'tokens',
    'errors',
  ]);
  return computeContentHash(
    JSON.stringify(dataProgram, (key, value) =>
      metadata.has(key) ? undefined : value,
    ),
  );
}

function captureExportTargets(
  result: LatticeGtsAnalysis,
  syntax: ModuleSyntax,
) {
  const locals = new Map<string, ClassReference>();
  syntax.possibleCardsOrFields.forEach((item, classIndex) => {
    if (item.localName)
      locals.set(item.localName, { type: 'internal', classIndex });
  });
  for (const statement of syntax.program.body) {
    if (!t.isImportDeclaration(statement) || statement.importKind === 'type')
      continue;
    for (const specifier of statement.specifiers) {
      if (t.isImportSpecifier(specifier) && specifier.importKind !== 'type') {
        locals.set(specifier.local.name, {
          type: 'external',
          module: statement.source.value,
          name: propertyName(specifier.imported)!,
        });
      } else if (t.isImportDefaultSpecifier(specifier)) {
        locals.set(specifier.local.name, {
          type: 'external',
          module: statement.source.value,
          name: 'default',
        });
      }
    }
  }
  const put = (name: string, target: ClassReference | undefined) => {
    const prior = result.exports.find((item) => item.name === name);
    const value: LatticeGtsExportAnalysis = {
      name,
      ...(target ? { target } : {}),
      fields: [],
      indexing:
        target && !result.diagnostics.length
          ? 'requires-linking'
          : 'chrome-data',
      reasons: [
        ...result.diagnostics,
        {
          code: target ? 'reexport-needs-linking' : 'unresolved-export-binding',
          message: target
            ? 'Resolve the exported definition and its code receipt'
            : 'No declarative target for this exported binding',
        },
      ],
    };
    if (prior) Object.assign(prior, value);
    else result.exports.push(value);
  };
  for (const statement of syntax.program.body) {
    if (
      t.isExportNamedDeclaration(statement) &&
      statement.exportKind !== 'type'
    ) {
      for (const specifier of statement.specifiers) {
        if (!t.isExportSpecifier(specifier) || specifier.exportKind === 'type')
          continue;
        const localName = propertyName(specifier.local)!;
        put(
          propertyName(specifier.exported)!,
          statement.source
            ? {
                type: 'external',
                module: statement.source.value,
                name: localName,
              }
            : locals.get(localName),
        );
      }
    } else if (
      t.isExportDefaultDeclaration(statement) &&
      t.isIdentifier(statement.declaration)
    ) {
      put('default', locals.get(statement.declaration.name));
    }
  }
  if (result.exports.length > 128) {
    result.state = 'blocked';
    result.exports = [];
    result.diagnostics.push({
      code: 'analysis-export-limit',
      message: 'Module exceeds 128 exported declarations',
    });
  }
}

function analyzeClass(
  declaration: PossibleCardOrFieldDeclaration,
  moduleReasons: LatticeGtsDiagnostic[],
): LatticeGtsExportAnalysis {
  const reasons = [...moduleReasons];
  const output: LatticeGtsExportAnalysis = {
    name: declaration.exportName ?? declaration.localName ?? '(anonymous)',
    ...(declaration.localName ? { localName: declaration.localName } : {}),
    ...(declaration.super ? { extends: declaration.super } : {}),
    indexing: 'requires-linking',
    fields: [],
    reasons,
  };
  const fieldNodes = new Set(
    [...declaration.possibleFields.values()].map((field) => field.path.node),
  );
  for (const member of declaration.path.node.body.body) {
    if (fieldNodes.has(member as t.ClassProperty) || isTemplate(member))
      continue;
    if (t.isClassProperty(member) && member.declare) continue;
    if (
      t.isClassProperty(member) &&
      member.static &&
      !member.computed &&
      (isLiteral(member.value) || isPresentationProperty(member))
    )
      continue;
    reasons.push(
      diagnostic(
        'custom-class-behavior',
        'Constructor, method, initializer or decorator requires compatible runtime analysis',
        member,
      ),
    );
  }
  if (declaration.path.node.decorators?.length)
    reasons.push(
      diagnostic(
        'class-decorator',
        'Class decorators require compatible runtime analysis',
        declaration.path.node,
      ),
    );
  for (const [name, field] of declaration.possibleFields) {
    const plan: LatticeGtsExportAnalysis['fields'][number] = {
      name,
      type: field.type,
      value: field.card,
      decorator: field.decorator,
    };
    const call = field.path.node.value;
    if (!t.isCallExpression(call)) continue;
    if (field.path.node.decorators?.length !== 1)
      reasons.push({
        ...diagnostic(
          'custom-field-decorator',
          'Only the declared field decorator is understood',
          field.path.node,
        ),
        field: name,
      });
    const options = call.arguments[1];
    if (options && !t.isObjectExpression(options)) {
      reasons.push({
        code: 'dynamic-field-options',
        message: 'Field options require execution',
        field: name,
      });
    } else if (t.isObjectExpression(options)) {
      for (const property of options.properties) {
        if (!t.isObjectProperty(property) || property.computed) {
          reasons.push({
            code: 'dynamic-field-options',
            message:
              'Field option spread/accessor/computed key requires execution',
            field: name,
          });
          continue;
        }
        const key = propertyName(property.key);
        if (key === 'computeVia') {
          try {
            plan.bxl = lowerBxl(property.value, field.path);
            if (!plan.bxl)
              reasons.push({
                code: 'javascript-compute',
                message:
                  'Computation is not a statically declared official BXL program',
                field: name,
              });
          } catch (error) {
            reasons.push({
              code: 'bxl-analysis-error',
              message: String((error as Error).message).slice(0, 1000),
              field: name,
            });
          }
        } else if (key === 'query') {
          const query = literalValue(property.value);
          if (query.ok) plan.query = query.value;
          else
            reasons.push({
              code: 'dynamic-query',
              message:
                'Query needs runtime construction or imported-value linking',
              field: name,
            });
        } else {
          reasons.push({
            code: 'field-option-needs-analysis',
            message: `Field option ${key ?? '(unknown)'} requires semantic analysis`,
            field: name,
          });
        }
      }
    }
    output.fields.push(plan);
  }
  if (reasons.length) output.indexing = 'chrome-data';
  else
    reasons.push({
      code: 'dependencies-need-linking',
      message:
        'Validate parent, field, decorator and imported implementation revisions before Node admission',
    });
  return output;
}

// A bounded syntax interpreter, never eval/Function/import. It resolves only
// immutable literals and expression-bodied local factories, so common BXL
// helpers do not force authored JavaScript execution in the data worker.
class StaticExpressionError extends Error {}
const staticClass = Symbol('static-class');
const staticBxl = Symbol('static-bxl');
type StaticEnvironment = Map<string, unknown>;
function staticValue(
  node: t.Node | null | undefined,
  path: NodePath,
  environment: StaticEnvironment = new Map(),
  budget = { steps: 0, active: new Set<t.Node>() },
): unknown {
  if (!node || ++budget.steps > 10000 || budget.active.size > 64)
    throw new StaticExpressionError('Static expression budget exceeded');
  const literal = literalValue(node);
  if (literal.ok) return literal.value;
  const descend = (child: t.Node | null | undefined) =>
    staticValue(child, path, environment, budget);
  if (t.isIdentifier(node)) {
    if (environment.has(node.name)) return environment.get(node.name);
    const binding = path.scope.getBinding(node.name);
    if (!binding?.constant)
      throw new StaticExpressionError('Mutable or unknown binding');
    if (binding.path.isClassDeclaration()) return { [staticClass]: true };
    if (
      !binding.path.isVariableDeclarator() ||
      !binding.path.node.init ||
      !binding.path.parentPath.isVariableDeclaration({ kind: 'const' })
    )
      throw new StaticExpressionError('Not an immutable expression');
    const init = binding.path.node.init;
    if (budget.active.has(init))
      throw new StaticExpressionError('Cyclic static expression');
    budget.active.add(init);
    try {
      return staticValue(init, binding.path, new Map(), budget);
    } finally {
      budget.active.delete(init);
    }
  }
  if (t.isTemplateLiteral(node)) {
    let value = node.quasis[0].value.cooked ?? node.quasis[0].value.raw;
    for (let i = 0; i < node.expressions.length; i++) {
      const part = descend(node.expressions[i]);
      if (!['string', 'number', 'boolean'].includes(typeof part))
        throw new StaticExpressionError(
          'Template interpolation must be scalar',
        );
      value +=
        String(part) +
        (node.quasis[i + 1].value.cooked ?? node.quasis[i + 1].value.raw);
      if (value.length > 1_048_576)
        throw new StaticExpressionError('Static string exceeds budget');
    }
    return value;
  }
  if (t.isArrayExpression(node)) return node.elements.map(descend);
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed)
        throw new StaticExpressionError(
          'Static object cannot have spreads or accessors',
        );
      const key = propertyName(property.key);
      if (!key)
        throw new StaticExpressionError('Static object needs literal keys');
      value[key] = descend(property.value);
    }
    return value;
  }
  if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
    const binding = path.scope.getBinding(node.callee.name);
    if (!binding?.constant)
      throw new StaticExpressionError('Mutable or unknown callee');
    const args = node.arguments.map(descend);
    if (
      binding.path.isImportSpecifier() &&
      binding.path.parentPath.isImportDeclaration() &&
      binding.path.parentPath.node.source.value === '@cardstack/bxl' &&
      ['bxl', 'expression', 'expr'].includes(
        propertyName(binding.path.node.imported) ?? '',
      )
    ) {
      const [text, supplied = {}] = args;
      if (
        args.length > 2 ||
        typeof text !== 'string' ||
        !supplied ||
        typeof supplied !== 'object' ||
        Array.isArray(supplied)
      )
        throw new StaticExpressionError('BXL requires static text and options');
      const options = { ...supplied } as Record<string, unknown>;
      if (
        Object.keys(options).some(
          (key) =>
            ![
              'readableSyntax',
              'libraries',
              'memoize',
              'validUntil',
              'freshUntil',
              'staleAfter',
              'as',
            ].includes(key),
        )
      )
        throw new StaticExpressionError('Unsupported static BXL option');
      const shape = options.as;
      if (
        shape !== undefined &&
        !(typeof shape === 'object' && shape !== null && staticClass in shape)
      )
        throw new StaticExpressionError(
          'BXL shape must be a local class binding',
        );
      delete options.as;
      const definition = getBxlComputeDefinition(
        bxl(text, options as BxlOptions),
      )!;
      return {
        [staticBxl]: { ...definition, materializesClass: shape !== undefined },
      };
    }
    if (
      !binding.path.isVariableDeclarator() ||
      !binding.path.parentPath.isVariableDeclaration({ kind: 'const' }) ||
      !t.isArrowFunctionExpression(binding.path.node.init) ||
      !t.isExpression(binding.path.node.init.body)
    )
      throw new StaticExpressionError(
        'Only expression-bodied const factories are static',
      );
    const factory = binding.path.node.init;
    if (
      factory.async ||
      factory.params.length !== args.length ||
      factory.params.some((param) => !t.isIdentifier(param)) ||
      budget.active.has(factory)
    )
      throw new StaticExpressionError(
        'Unsupported or recursive static factory',
      );
    const params = new Map(
      factory.params.map((param, index) => [
        (param as t.Identifier).name,
        args[index],
      ]),
    );
    budget.active.add(factory);
    try {
      return staticValue(factory.body, binding.path, params, budget);
    } finally {
      budget.active.delete(factory);
    }
  }
  throw new StaticExpressionError(`Unsupported static expression ${node.type}`);
}

function lowerBxl(
  node: t.Node,
  path: NodePath,
): BxlComputeDefinition | undefined {
  let value: unknown;
  try {
    value = staticValue(node, path);
  } catch (error) {
    if (error instanceof StaticExpressionError) return undefined;
    throw error;
  }
  return typeof value === 'object' && value !== null && staticBxl in value
    ? (value as { [staticBxl]: BxlComputeDefinition })[staticBxl]
    : undefined;
}

function propertyName(node: t.Node): string | undefined {
  return t.isIdentifier(node)
    ? node.name
    : t.isStringLiteral(node)
      ? node.value
      : undefined;
}

function literalValue(
  node: t.Node | null | undefined,
): { ok: true; value: unknown } | { ok: false } {
  if (
    t.isStringLiteral(node) ||
    t.isNumericLiteral(node) ||
    t.isBooleanLiteral(node)
  )
    return { ok: true, value: node.value };
  if (t.isNullLiteral(node)) return { ok: true, value: null };
  if (t.isTemplateLiteral(node) && node.expressions.length === 0)
    return {
      ok: true,
      value: node.quasis[0].value.cooked ?? node.quasis[0].value.raw,
    };
  if (
    t.isUnaryExpression(node) &&
    node.operator === '-' &&
    t.isNumericLiteral(node.argument)
  )
    return { ok: true, value: -node.argument.value };
  if (t.isArrayExpression(node)) {
    const values = node.elements.map(literalValue);
    return values.every((value) => value.ok)
      ? { ok: true, value: values.map((value) => value.value) }
      : { ok: false };
  }
  if (t.isObjectExpression(node)) {
    const value: Record<string, unknown> = Object.create(null);
    for (const property of node.properties) {
      if (!t.isObjectProperty(property) || property.computed)
        return { ok: false };
      const key = propertyName(property.key);
      const item = literalValue(property.value);
      if (!key || !item.ok) return { ok: false };
      value[key] = item.value;
    }
    return { ok: true, value };
  }
  return { ok: false };
}

function isLiteral(node: t.Node | null | undefined): boolean {
  return !node || literalValue(node).ok;
}

function isTemplate(node: t.Node): boolean {
  return (
    t.isClassProperty(node) &&
    node.computed &&
    t.isCallExpression(node.key) &&
    t.isIdentifier(node.key.callee, { name: 'templatePlaceholder' })
  );
}

function isPresentationProperty(node: t.ClassProperty): boolean {
  return (
    [
      'isolated',
      'embedded',
      'fitted',
      'atom',
      'head',
      'markdown',
      'icon',
    ].includes(propertyName(node.key) ?? '') &&
    (t.isIdentifier(node.value) ||
      t.isClassExpression(node.value) ||
      t.isArrowFunctionExpression(node.value) ||
      isTemplateExpression(node.value))
  );
}

function diagnostic(
  code: string,
  message: string,
  node: t.Node,
): LatticeGtsDiagnostic {
  return { code, message, ...(node.loc ? { line: node.loc.start.line } : {}) };
}

function isTemplateExpression(node: t.Node | null | undefined): boolean {
  return (
    t.isArrayExpression(node) &&
    node.elements.length === 1 &&
    t.isCallExpression(node.elements[0]) &&
    t.isIdentifier(node.elements[0].callee, { name: 'templatePlaceholder' })
  );
}

function hasStaticEffects(
  node: t.ClassDeclaration | t.ClassExpression,
): boolean {
  return (
    Boolean(node.decorators?.length) ||
    node.body.body.some(
      (member) =>
        t.isStaticBlock(member) ||
        (t.isClassProperty(member) &&
          member.static &&
          !isTemplate(member) &&
          !isLiteral(member.value) &&
          !t.isIdentifier(member.value) &&
          !t.isArrowFunctionExpression(member.value) &&
          !t.isFunctionExpression(member.value) &&
          !isTemplateExpression(member.value) &&
          !(
            t.isClassExpression(member.value) && !hasStaticEffects(member.value)
          )),
    )
  );
}

function moduleDiagnostics(
  program: t.Program,
  path?: NodePath,
): LatticeGtsDiagnostic[] {
  const isStatic = (node: t.Node | null | undefined) => {
    if (!path || !node) return false;
    try {
      staticValue(node, path);
      return true;
    } catch {
      return false;
    }
  };
  const diagnostics: LatticeGtsDiagnostic[] = [];
  for (const statement of program.body) {
    if (
      t.isExportDefaultDeclaration(statement) &&
      t.isIdentifier(statement.declaration)
    )
      continue;
    const node =
      t.isExportNamedDeclaration(statement) ||
      t.isExportDefaultDeclaration(statement)
        ? statement.declaration
        : statement;
    if (
      !node ||
      t.isImportDeclaration(node) ||
      t.isExportAllDeclaration(node) ||
      t.isFunctionDeclaration(node) ||
      (t.isClassDeclaration(node) && !hasStaticEffects(node)) ||
      t.isTSInterfaceDeclaration(node) ||
      t.isTSTypeAliasDeclaration(node) ||
      t.isEmptyStatement(node)
    )
      continue;
    if (
      t.isVariableDeclaration(node) &&
      node.kind === 'const' &&
      node.declarations.every(
        (item) =>
          t.isIdentifier(item.id) &&
          (isLiteral(item.init) ||
            isStatic(item.init) ||
            isTemplateExpression(item.init) ||
            t.isArrowFunctionExpression(item.init) ||
            t.isFunctionExpression(item.init)),
      )
    )
      continue;
    diagnostics.push(
      diagnostic(
        'module-runtime-initialization',
        'Module initialization requires compatible runtime analysis',
        node,
      ),
    );
  }
  return diagnostics;
}
