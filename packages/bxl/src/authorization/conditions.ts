import { parseBxlAst } from '../bxl/ast/index.js';
import { prepareNativeJq } from '../bxl/bridge/native.js';
import { AuthorizationError } from './errors.js';
import type { CompiledAuthorizationCondition } from './ir.js';
import type { BxlAuthorizationCondition } from './model.js';

function validParameter(value: unknown, type: string): boolean {
  switch (type) {
    case 'any':
      return true;
    case 'bool':
    case 'boolean':
      return typeof value === 'boolean';
    case 'int':
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'double':
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'ipaddress':
      return typeof value === 'string';
    case 'timestamp':
      return typeof value === 'string' && Number.isFinite(Date.parse(value));
    default:
      return false;
  }
}

export function compileAuthorizationCondition(
  name: string,
  definition: BxlAuthorizationCondition,
  path: string,
): CompiledAuthorizationCondition {
  const program = parseBxlAst(definition.expression, { profile: 'policy' });
  const profileErrors = program.profileIssues.filter((issue) => issue.severity === 'error');
  if (profileErrors.length > 0) {
    throw new AuthorizationError(
      'unsafe-expression',
      profileErrors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'),
      { path },
    );
  }

  let prepared;
  try {
    prepared = prepareNativeJq(definition.expression, {
      libraries: ['core', 'authorization'],
      runtimeLimits: {
        maxSteps: 10_000,
        maxOutputBytes: 1_024,
      },
    });
  } catch (cause) {
    throw new AuthorizationError(
      'invalid-expression',
      `Could not prepare authorization condition ${name}.`,
      { path, cause },
    );
  }

  const parameters = definition.parameters ?? {};
  return {
    name,
    source: definition.expression,
    parameters,
    evaluate(requestContext, tupleContext = {}) {
      const context = { ...requestContext, ...tupleContext };
      for (const [parameter, type] of Object.entries(parameters)) {
        if (!(parameter in context)) {
          throw new AuthorizationError(
            'invalid-model',
            `Condition ${name} is missing required context parameter ${parameter}.`,
            { path: `context.${parameter}` },
          );
        }
        if (!validParameter(context[parameter], type)) {
          throw new AuthorizationError(
            'invalid-model',
            `Condition ${name} parameter ${parameter} is not a valid ${type}.`,
            { path: `context.${parameter}` },
          );
        }
      }

      let outputs: unknown[];
      try {
        outputs = prepared.run(
          { context },
          {
            runtimeLimits: {
              maxSteps: 10_000,
              maxOutputBytes: 1_024,
            },
          },
        ).outputs;
      } catch (cause) {
        throw new AuthorizationError(
          'invalid-model',
          `Condition ${name} evaluation failed.`,
          { path, cause },
        );
      }
      if (outputs.length !== 1 || typeof outputs[0] !== 'boolean') {
        throw new AuthorizationError(
          'invalid-model',
          `Condition ${name} must produce exactly one boolean value.`,
          { path },
        );
      }
      return outputs[0];
    },
  };
}
