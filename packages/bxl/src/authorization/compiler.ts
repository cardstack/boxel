import { parseBxlAst } from '../bxl/ast/index.ts';
import {
  parseNativeJq,
  prepareNativeJqExpression,
} from '../bxl/bridge/native.ts';
import type { ExpressionAst } from '../jqtools/parser/AST.ts';
import { compileAuthorizationCondition } from './conditions.ts';
import { AuthorizationError } from './errors.ts';
import {
  assertTypeOrRelationName,
  parseSubjectTypeConstraint,
} from './identifiers.ts';
import type {
  AuthorizationRelationExpression,
  CompiledAuthorizationGraph,
  CompiledAuthorizationRelation,
  CompiledAuthorizationType,
} from './ir.ts';
import {
  BXL_AUTHORIZATION_IR_SCHEMA,
  type AuthorizationGraphRelation,
  type AuthorizationGraphModel,
  type AuthorizationGraphRelationDefinition,
  type SubjectTypeReference,
} from './graph-model.ts';

const GRAPH_CALLS = new Set(['direct', 'userset', 'userset_from', 'except']);

function literalString(node: ExpressionAst, path: string): string {
  if (node.type !== 'str' || node.interpolated !== false) {
    throw new AuthorizationError(
      'invalid-expression',
      'Authorization graph targets must be literal strings.',
      { path },
    );
  }
  return node.value;
}

function filterName(node: Extract<ExpressionAst, { type: 'filter' }>): string {
  return node.name.replace(/\/\d+$/, '');
}

function containsGraphCall(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  if (
    'type' in node &&
    node.type === 'filter' &&
    'name' in node &&
    typeof node.name === 'string' &&
    GRAPH_CALLS.has(node.name.replace(/\/\d+$/, ''))
  ) {
    return true;
  }
  return Object.values(node).some((value) =>
    Array.isArray(value)
      ? value.some(containsGraphCall)
      : containsGraphCall(value),
  );
}

function flatten(
  kind: 'union' | 'intersection',
  children: readonly AuthorizationRelationExpression[],
): AuthorizationRelationExpression {
  const flattened = children.flatMap((child) =>
    child.kind === kind ? child.children : [child],
  );
  return { kind, children: flattened };
}

function lowerAuthorizationExpression(
  node: ExpressionAst,
  path: string,
): AuthorizationRelationExpression {
  if (
    node.type === 'binary' &&
    (node.operator === 'or' || node.operator === 'and')
  ) {
    const kind = node.operator === 'or' ? 'union' : 'intersection';
    return flatten(kind, [
      lowerAuthorizationExpression(node.left, `${path}.left`),
      lowerAuthorizationExpression(node.right, `${path}.right`),
    ]);
  }

  if (node.type === 'filter' && filterName(node) === 'direct') {
    if (node.args.length !== 0) {
      throw new AuthorizationError(
        'invalid-expression',
        'direct() accepts no arguments.',
        {
          path,
        },
      );
    }
    return { kind: 'direct' };
  }

  if (node.type === 'filter' && filterName(node) === 'userset') {
    if (node.args.length !== 1) {
      throw new AuthorizationError(
        'invalid-expression',
        'userset() requires one literal relation name.',
        { path },
      );
    }
    return {
      kind: 'computed',
      relation: literalString(node.args[0]!, `${path}.args[0]`),
    };
  }

  if (node.type === 'filter' && filterName(node) === 'userset_from') {
    if (node.args.length !== 2) {
      throw new AuthorizationError(
        'invalid-expression',
        'userset_from() requires literal tupleset and computed relation names.',
        { path },
      );
    }
    return {
      kind: 'tupleToUserset',
      tupleset: literalString(node.args[0]!, `${path}.args[0]`),
      computed: literalString(node.args[1]!, `${path}.args[1]`),
    };
  }

  if (node.type === 'filter' && filterName(node) === 'except') {
    if (node.args.length !== 2) {
      throw new AuthorizationError(
        'invalid-expression',
        'except() requires base and subtract expressions.',
        { path },
      );
    }
    return {
      kind: 'difference',
      base: lowerAuthorizationExpression(node.args[0]!, `${path}.base`),
      subtract: lowerAuthorizationExpression(node.args[1]!, `${path}.subtract`),
    };
  }

  if (containsGraphCall(node)) {
    throw new AuthorizationError(
      'invalid-expression',
      'Graph calls may only participate in `or`, `and`, or `except()` authorization composition.',
      { path },
    );
  }

  const prepared = prepareNativeJqExpression(node, {
    runtimeLimits: { maxSteps: 10_000, maxOutputBytes: 1_024 },
  });
  return {
    kind: 'predicate',
    evaluate(input) {
      const nativeContext = input.context.__bxlAuthorization;
      const boxel =
        nativeContext && typeof nativeContext === 'object'
          ? (nativeContext as {
              resources?: Readonly<Record<string, unknown>>;
              parties?: Readonly<Record<string, unknown>>;
              policy?: unknown;
            })
          : undefined;
      // Graph-level callers continue to receive the original
      // { context, subject, object, relation } envelope. BXL Authorization
      // additionally projects the current recursive graph node into the
      // native Resource · Input · Party · Now · Policy BXL envelope. Looking the
      // resource up by `input.object.canonical` is important: a via() traversal
      // must evaluate Resource fields on the linked resource, not on the request root.
      const evaluationInput = boxel
        ? {
            ...input,
            resource: boxel.resources?.[input.object.canonical],
            input: input.context.input ?? {},
            party: boxel.parties?.[input.subject.canonical],
            now: input.context.now,
            policy: boxel.policy ?? {},
          }
        : input;
      const outputs = prepared.run(evaluationInput, {
        runtimeLimits: { maxSteps: 10_000, maxOutputBytes: 1_024 },
      }).outputs;
      if (outputs.length !== 1 || typeof outputs[0] !== 'boolean') {
        throw new AuthorizationError(
          'invalid-model',
          'An authorization predicate must produce exactly one boolean value.',
          { path },
        );
      }
      return outputs[0];
    },
  };
}

function normalizedRelation(definition: AuthorizationGraphRelationDefinition): {
  subjects: readonly SubjectTypeReference[];
  rewrite: string;
} {
  if (Array.isArray(definition)) {
    return { subjects: definition, rewrite: 'direct()' };
  }
  const relation = definition as AuthorizationGraphRelation;
  const subjects = relation.subjects ?? [];
  const rewrite = relation.rewrite ?? (subjects.length > 0 ? 'direct()' : '');
  return { subjects, rewrite };
}

function compileRelation(
  typeName: string,
  name: string,
  definition: AuthorizationGraphRelationDefinition | string,
  assignable: boolean,
): CompiledAuthorizationRelation {
  const path = `types.${typeName}.${assignable ? 'relations' : 'permissions'}.${name}`;
  const normalized = assignable
    ? normalizedRelation(definition as AuthorizationGraphRelationDefinition)
    : {
        subjects: [] as readonly SubjectTypeReference[],
        rewrite: definition as string,
      };

  if (normalized.rewrite.trim() === '') {
    throw new AuthorizationError(
      'invalid-model',
      'A relation without directly assignable subjects must declare a rewrite.',
      { path },
    );
  }

  let program;
  try {
    program = parseBxlAst(normalized.rewrite, { profile: 'authorization' });
  } catch (cause) {
    throw new AuthorizationError(
      'invalid-expression',
      'Could not parse authorization expression.',
      {
        path,
        cause,
      },
    );
  }
  const profileErrors = program.profileIssues.filter(
    (issue) => issue.severity === 'error',
  );
  if (profileErrors.length > 0) {
    throw new AuthorizationError(
      'unsafe-expression',
      profileErrors
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join('\n'),
      { path },
    );
  }
  if (!program.body) {
    throw new AuthorizationError(
      'invalid-expression',
      'Authorization expression is empty.',
      {
        path,
      },
    );
  }

  const nativeProgram = parseNativeJq(program.canonicalSource, {
    readableSyntax: false,
  });
  if (!nativeProgram.ast.expr) {
    throw new AuthorizationError(
      'invalid-expression',
      'Authorization expression is empty.',
      {
        path,
      },
    );
  }
  const expression = lowerAuthorizationExpression(
    nativeProgram.ast.expr,
    `${path}.rewrite`,
  );
  if (!assignable && containsKind(expression, 'direct')) {
    throw new AuthorizationError(
      'invalid-model',
      'A permission cannot use direct() because permissions are not tuple-assignable.',
      { path },
    );
  }

  return {
    name,
    assignable,
    allowedSubjects: normalized.subjects.map((subject, index) =>
      parseSubjectTypeConstraint(subject, `${path}.subjects[${index}]`),
    ),
    expression,
    source: normalized.rewrite,
  };
}

function containsKind(
  expression: AuthorizationRelationExpression,
  kind: AuthorizationRelationExpression['kind'],
): boolean {
  if (expression.kind === kind) return true;
  switch (expression.kind) {
    case 'union':
    case 'intersection':
      return expression.children.some((child) => containsKind(child, kind));
    case 'difference':
      return (
        containsKind(expression.base, kind) ||
        containsKind(expression.subtract, kind)
      );
    default:
      return false;
  }
}

function validateExpressionReferences(
  model: CompiledAuthorizationGraph,
  ownerType: CompiledAuthorizationType,
  ownerRelation: CompiledAuthorizationRelation,
  expression: AuthorizationRelationExpression,
): void {
  const path = `types.${ownerType.name}.${ownerRelation.name}`;
  switch (expression.kind) {
    case 'computed': {
      if (!ownerType.relations.has(expression.relation)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Unknown relation ${ownerType.name}#${expression.relation}.`,
          { path },
        );
      }
      return;
    }
    case 'tupleToUserset': {
      const tupleset = ownerType.relations.get(expression.tupleset);
      if (!tupleset || !tupleset.assignable) {
        throw new AuthorizationError(
          'unknown-relation',
          `Tuple-to-userset source ${ownerType.name}#${expression.tupleset} must be an assignable relation.`,
          { path },
        );
      }
      for (const subjectType of tupleset.allowedSubjects) {
        if (subjectType.relation !== undefined || subjectType.wildcard) {
          throw new AuthorizationError(
            'invalid-model',
            `Tuple-to-userset source ${ownerType.name}#${expression.tupleset} cannot target ${subjectType.canonical}; it must target objects.`,
            { path },
          );
        }
        // OpenFGA allows a tupleset to target multiple object types even when
        // some of those types do not define the computed relation. Those
        // branches are false at request time; they are not model errors.
      }
      return;
    }
    case 'union':
    case 'intersection':
      for (const child of expression.children) {
        validateExpressionReferences(model, ownerType, ownerRelation, child);
      }
      return;
    case 'difference':
      validateExpressionReferences(
        model,
        ownerType,
        ownerRelation,
        expression.base,
      );
      validateExpressionReferences(
        model,
        ownerType,
        ownerRelation,
        expression.subtract,
      );
      return;
    case 'direct':
    case 'predicate':
      return;
  }
}

export function compileAuthorizationGraph(
  input: AuthorizationGraphModel,
): CompiledAuthorizationGraph {
  if (
    !input ||
    typeof input !== 'object' ||
    input.schema !== BXL_AUTHORIZATION_IR_SCHEMA
  ) {
    throw new AuthorizationError(
      'invalid-model',
      `Authorization model schema must be ${BXL_AUTHORIZATION_IR_SCHEMA}.`,
      { path: 'schema' },
    );
  }
  if (
    !input.types ||
    typeof input.types !== 'object' ||
    Array.isArray(input.types)
  ) {
    throw new AuthorizationError(
      'invalid-model',
      'Authorization model types must be an object.',
      {
        path: 'types',
      },
    );
  }

  const conditions = new Map(
    Object.entries(input.conditions ?? {}).map(([name, definition]) => {
      assertTypeOrRelationName(name, `conditions.${name}`);
      return [
        name,
        compileAuthorizationCondition(name, definition, `conditions.${name}`),
      ];
    }),
  );

  const types = new Map<string, CompiledAuthorizationType>();
  for (const [typeName, definition] of Object.entries(input.types)) {
    assertTypeOrRelationName(typeName, `types.${typeName}`);
    const relations = new Map<string, CompiledAuthorizationRelation>();

    for (const [name, relation] of Object.entries(definition.relations ?? {})) {
      assertTypeOrRelationName(name, `types.${typeName}.relations.${name}`);
      relations.set(name, compileRelation(typeName, name, relation, true));
    }
    for (const [name, permission] of Object.entries(
      definition.permissions ?? {},
    )) {
      assertTypeOrRelationName(name, `types.${typeName}.permissions.${name}`);
      if (relations.has(name)) {
        throw new AuthorizationError(
          'invalid-model',
          `Relation and permission names collide at ${typeName}#${name}.`,
          { path: `types.${typeName}.permissions.${name}` },
        );
      }
      relations.set(name, compileRelation(typeName, name, permission, false));
    }
    types.set(typeName, { name: typeName, relations });
  }

  const compiled: CompiledAuthorizationGraph = {
    schema: BXL_AUTHORIZATION_IR_SCHEMA,
    types,
    conditions,
  };

  for (const type of types.values()) {
    for (const relation of type.relations.values()) {
      for (const subject of relation.allowedSubjects) {
        const subjectType = types.get(subject.type);
        if (!subjectType) {
          throw new AuthorizationError(
            'unknown-type',
            `Unknown subject type ${subject.type}.`,
            { path: `types.${type.name}.${relation.name}` },
          );
        }
        if (
          subject.relation !== undefined &&
          !subjectType.relations.has(subject.relation)
        ) {
          throw new AuthorizationError(
            'unknown-relation',
            `Unknown userset relation ${subject.canonical}.`,
            { path: `types.${type.name}.${relation.name}` },
          );
        }
        if (
          subject.condition !== undefined &&
          !conditions.has(subject.condition)
        ) {
          throw new AuthorizationError(
            'invalid-model',
            `Unknown authorization condition ${subject.condition}.`,
            { path: `types.${type.name}.${relation.name}` },
          );
        }
      }
      validateExpressionReferences(
        compiled,
        type,
        relation,
        relation.expression,
      );
    }
  }

  return compiled;
}
