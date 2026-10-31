import type { Rule } from 'eslint';
import { lowerCallApiRequest } from '../card-operations/lowering.ts';
import { operationLabelProblem } from '../card-operations/label.ts';
import type { CallApiClauses } from '../card-operations/call-api.ts';

// The `callApi` declarations of a card module, checked before the module is
// indexed. Lowering checks a declaration when its module is indexed and
// records each problem on the type's definition, where it only surfaces when
// the operation is invoked. This rule reads each `@operation static … = {
// base: 'callApi', … }` from source, rebuilds the value lowering would be
// handed, and runs it through the same lowering (`lowerCallApiRequest`), so
// it reports exactly what indexing would, one problem per issue.
//
// Two rules share the reading. `call-api` is an error: each lowering issue,
// and a `label` lowering refuses. A destination whose path doesn't end in `/`
// is never one to report: lowering ends every destination at a `/`.
// `call-api-advice` is a warning, for what lowering
// accepts: a destination that isn't `https:`, which the realm server refuses
// to send unless its host is on a development allowlist (as local stub
// vendors are), and an operation with no `label`, which the secure window and
// the key page fall back to naming by its words.
//
// Only what source states is read. A value the rule can't work out from the
// file (an imported constant, a function call that isn't a typed reference)
// stands in as an opaque typed reference, which lowering accepts wherever a
// value goes. When a whole request member is such a value, or the URL is,
// the request isn't lowered at all, since anything it reported would be a
// guess; the label is still checked.

// A value read from source that the rule can't work out.
const UNKNOWN = { $ref: 'lint:unknown' } as const;

type Node = any;

const REFERENCE_MAKERS: Record<string, (args: unknown[]) => unknown> = {
  params: ([key]) => ({ $ref: 'params', key }),
  actor: () => ({ $ref: 'actor' }),
  instance: ([key]) =>
    key === undefined ? { $ref: 'instance' } : { $ref: 'instance', key },
  realmConfig: ([key]) =>
    key === undefined ? { $ref: 'realmConfig' } : { $ref: 'realmConfig', key },
  card: ([value]) => ({ $ref: 'card', value }),
};

const REQUEST_MEMBERS = [
  'method',
  'url',
  'path',
  'headers',
  'query',
  'json',
  'graphql',
  'perInstance',
] as const;

function isUnknown(value: unknown): boolean {
  return value === UNKNOWN;
}

function keyOf(property: Node): string | undefined {
  if (property.computed) {
    return property.key.type === 'Literal' &&
      typeof property.key.value === 'string'
      ? property.key.value
      : undefined;
  }
  if (property.key.type === 'Identifier') {
    return property.key.name;
  }
  if (property.key.type === 'Literal') {
    return String(property.key.value);
  }
  return undefined;
}

// The value an expression evaluates to, as far as source alone says.
function evaluate(
  node: Node,
  scope: Rule.RuleContext['sourceCode'],
  depth = 0,
): unknown {
  if (!node || depth > 20) {
    return UNKNOWN;
  }
  switch (node.type) {
    case 'Literal':
      return node.regex ? UNKNOWN : node.value;
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSNonNullExpression':
    case 'TSTypeAssertion':
      return evaluate(node.expression, scope, depth + 1);
    case 'TemplateLiteral': {
      let text = '';
      for (let [i, quasi] of node.quasis.entries()) {
        text += quasi.value.cooked ?? quasi.value.raw;
        if (i < node.expressions.length) {
          let value = evaluate(node.expressions[i], scope, depth + 1);
          if (isUnknown(value)) {
            return UNKNOWN;
          }
          // A typed reference spliced into text keeps nothing of it, as at
          // run time, and lowering reports it.
          text +=
            value !== null && typeof value === 'object'
              ? '[object Object]'
              : String(value);
        }
      }
      return text;
    }
    case 'TaggedTemplateExpression':
      if (node.tag.type === 'Identifier' && node.tag.name === 'bxl') {
        return {
          $bxl: node.quasi.quasis
            .map((q: Node) => q.value.cooked ?? q.value.raw)
            .join(''),
        };
      }
      return UNKNOWN;
    case 'ObjectExpression': {
      let object: Record<string, unknown> = {};
      for (let property of node.properties) {
        if (property.type !== 'Property' || property.kind !== 'init') {
          return UNKNOWN;
        }
        let key = keyOf(property);
        if (key === undefined) {
          return UNKNOWN;
        }
        object[key] = evaluate(property.value, scope, depth + 1);
      }
      return object;
    }
    case 'ArrayExpression':
      return node.elements.map((element: Node) =>
        element && element.type !== 'SpreadElement'
          ? evaluate(element, scope, depth + 1)
          : UNKNOWN,
      );
    case 'CallExpression': {
      let maker =
        node.callee.type === 'Identifier'
          ? REFERENCE_MAKERS[node.callee.name]
          : undefined;
      if (!maker) {
        return UNKNOWN;
      }
      let args = node.arguments.map((arg: Node) =>
        evaluate(arg, scope, depth + 1),
      );
      return args.some(isUnknown) ? UNKNOWN : maker(args);
    }
    case 'Identifier': {
      // A `const` in this file with a literal value.
      let variable = findVariable(scope.getScope(node), node.name);
      let definition = variable?.defs[0];
      if (
        definition?.type === 'Variable' &&
        definition.parent?.kind === 'const' &&
        definition.node.init
      ) {
        return evaluate(definition.node.init, scope, depth + 1);
      }
      return UNKNOWN;
    }
    default:
      return UNKNOWN;
  }
}

function findVariable(scope: any, name: string): any {
  for (let s = scope; s; s = s.upper) {
    let found = s.set?.get(name);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function isOperationDecorator(decorator: Node): boolean {
  let expression = decorator.expression;
  return (
    (expression.type === 'Identifier' && expression.name === 'operation') ||
    (expression.type === 'CallExpression' &&
      expression.callee.type === 'Identifier' &&
      expression.callee.name === 'operation')
  );
}

// The member of `declaration` an issue path names, for where to report it:
// `headers.authorization` reports at `headers`.
function memberNode(declaration: Node, path: string): Node {
  let first = path.split(/[.[]/)[0];
  let property = declaration.properties.find(
    (p: Node) => p.type === 'Property' && keyOf(p) === first,
  );
  return property ?? declaration;
}

type Check = 'call-api' | 'call-api-advice';

function makeRule(check: Check): Rule.RuleModule {
  let errors = check === 'call-api';
  return {
    meta: {
      type: errors ? 'problem' : 'suggestion',
      docs: {
        description: errors
          ? 'Report the problems indexing would record for a `callApi` operation declaration, before the module is indexed'
          : 'Report what a `callApi` operation declaration is missing for its approval screens, or would be refused when sent',
      },
      schema: [],
      messages: {
        lowering: '{{code}}: {{message}}',
        insecureDestination:
          'This request goes to {{destination}}, which is not https: the realm server refuses to send it unless its host is on a development allowlist',
        missingLabel:
          'Give this `callApi` operation a `label`: a short phrase for people, which the secure window shows when someone approves it',
        invalidLabel: 'invalid-label: {{message}}',
      },
    },
    create(context) {
      let sourceCode = context.sourceCode ?? context.getSourceCode();
      return {
        PropertyDefinition(node: Node) {
          if (
            !node.static ||
            !node.decorators?.some(isOperationDecorator) ||
            node.value?.type !== 'ObjectExpression'
          ) {
            return;
          }
          let declarationNode = node.value;
          let value = evaluate(declarationNode, sourceCode);
          if (!value || typeof value !== 'object' || isUnknown(value)) {
            return;
          }
          let declaration = value as Record<string, unknown>;
          if (declaration.base !== 'callApi') {
            return;
          }

          if (declaration.label === undefined) {
            if (!errors) {
              context.report({ node: node.key, messageId: 'missingLabel' });
            }
          } else if (errors && !isUnknown(declaration.label)) {
            let problem = operationLabelProblem(declaration.label);
            if (problem) {
              context.report({
                node: memberNode(declarationNode, 'label'),
                messageId: 'invalidLabel',
                data: { message: problem },
              });
            }
          }

          if (
            typeof declaration.url !== 'string' ||
            REQUEST_MEMBERS.some((member) => isUnknown(declaration[member]))
          ) {
            return;
          }
          let params = declaration.params;
          if (isUnknown(params)) {
            return;
          }
          let paramNames = new Set(
            params && typeof params === 'object' ? Object.keys(params) : [],
          );
          let issues: { code: string; path: string; message: string }[] = [];
          let request = lowerCallApiRequest(
            declaration as CallApiClauses,
            paramNames,
            {
              add: (code, path, message) =>
                issues.push({ code, path, message }),
            },
          );
          for (let { code, path, message } of errors ? issues : []) {
            context.report({
              node: memberNode(declarationNode, path),
              messageId: 'lowering',
              data: { code, message },
            });
          }
          if (!request) {
            return;
          }
          let destination = new URL(request.destination);
          if (!errors && destination.protocol !== 'https:') {
            context.report({
              node: memberNode(declarationNode, 'url'),
              messageId: 'insecureDestination',
              data: { destination: request.destination },
            });
          }
        },
      };
    },
  };
}

// The rules as an ESLint plugin, which the lint engine registers under
// `@cardstack/boxel-operations`.
export const callApiLintPlugin = {
  rules: {
    'call-api': makeRule('call-api'),
    'call-api-advice': makeRule('call-api-advice'),
  },
};
