import { transformer } from '@openfga/syntax-transformer';
import { parse } from 'yaml';
import {
  prepareAuthorizationGraphSafe,
  type AuthorizationGraphModel,
  type AuthorizationGraphRelationDefinition,
  type RelationshipTuple,
  type SubjectTypeReference,
} from '../../../src/authorization/index.ts';

type JsonRecord = Record<string, unknown>;

interface UpstreamAssertion {
  tuple?: { user?: string; relation?: string; object?: string };
  contextualTuples?: UpstreamTuple[];
  context?: Readonly<Record<string, unknown>>;
  expectation?: boolean;
  errorCode?: number;
}

interface UpstreamListObjectsAssertion {
  request: { user: string; type: string; relation: string };
  contextualTuples?: UpstreamTuple[];
  context?: Readonly<Record<string, unknown>>;
  expectation?: string[] | null;
  errorCode?: number;
}

interface UpstreamListUsersAssertion {
  request: { object: string; relation: string; filters: string[] };
  contextualTuples?: UpstreamTuple[];
  context?: Readonly<Record<string, unknown>>;
  expectation?: string[] | null;
  errorCode?: number;
}

interface UpstreamTuple {
  user: string;
  relation: string;
  object: string;
  condition?: { name: string; context?: Readonly<Record<string, unknown>> };
}

interface UpstreamStage {
  name?: string;
  model: string;
  tuples?: UpstreamTuple[];
  checkAssertions?: UpstreamAssertion[];
  listObjectsAssertions?: UpstreamListObjectsAssertion[];
  listUsersAssertions?: UpstreamListUsersAssertion[];
}

interface UpstreamTest {
  name: string;
  stages: UpstreamStage[];
}

interface UpstreamFixture {
  tests: UpstreamTest[];
}

export interface OpenFgaConformanceFailure {
  fixture: string;
  test: string;
  stage: number;
  assertion?: number;
  kind: 'decision' | 'error' | 'importer' | 'unsupported';
  message: string;
}

export interface OpenFgaConformanceReport {
  discovered: number;
  passed: number;
  failed: number;
  importerFailures: number;
  unsupported: number;
  check: {
    discovered: number;
    passed: number;
    failed: number;
    importerFailures: number;
    unsupported: number;
  };
  listObjects: {
    discovered: number;
    passed: number;
    failed: number;
    importerFailures: number;
    unsupported: number;
  };
  listUsers: {
    discovered: number;
    passed: number;
    failed: number;
    importerFailures: number;
    unsupported: number;
  };
  failures: OpenFgaConformanceFailure[];
}

function record(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as JsonRecord;
}

function relationName(node: unknown, path: string): string {
  const value = record(node, path).relation;
  if (typeof value !== 'string' || value === '') {
    throw new Error(`${path}.relation must be a non-empty string`);
  }
  return value;
}

function openFgaRewriteToBxl(node: unknown, path: string): string {
  const rewrite = record(node, path);
  if ('this' in rewrite) return 'direct()';
  if ('computedUserset' in rewrite) {
    return `userset(${JSON.stringify(relationName(rewrite.computedUserset, `${path}.computedUserset`))})`;
  }
  if ('tupleToUserset' in rewrite) {
    const ttu = record(rewrite.tupleToUserset, `${path}.tupleToUserset`);
    return `userset_from(${JSON.stringify(
      relationName(ttu.tupleset, `${path}.tupleToUserset.tupleset`),
    )}; ${JSON.stringify(
      relationName(
        ttu.computedUserset,
        `${path}.tupleToUserset.computedUserset`,
      ),
    )})`;
  }
  for (const [property, operator] of [
    ['union', 'or'],
    ['intersection', 'and'],
  ] as const) {
    if (property in rewrite) {
      const children = record(rewrite[property], `${path}.${property}`).child;
      if (!Array.isArray(children) || children.length === 0) {
        throw new Error(`${path}.${property}.child must be a non-empty array`);
      }
      return children
        .map(
          (child, index) =>
            `(${openFgaRewriteToBxl(child, `${path}.${property}.child[${index}]`)})`,
        )
        .join(` ${operator} `);
    }
  }
  if ('difference' in rewrite) {
    const difference = record(rewrite.difference, `${path}.difference`);
    return `except(${openFgaRewriteToBxl(
      difference.base,
      `${path}.difference.base`,
    )}; ${openFgaRewriteToBxl(
      difference.subtract,
      `${path}.difference.subtract`,
    )})`;
  }
  throw new Error(`${path} has an unsupported OpenFGA rewrite shape`);
}

function subjectConstraint(
  reference: unknown,
  path: string,
): SubjectTypeReference {
  const value = record(reference, path);
  if (typeof value.type !== 'string' || value.type === '') {
    throw new Error(`${path}.type must be a non-empty string`);
  }
  const relation =
    typeof value.relation === 'string' && value.relation !== ''
      ? value.relation
      : undefined;
  const wildcard = 'wildcard' in value;
  const condition =
    typeof value.condition === 'string' && value.condition !== ''
      ? value.condition
      : undefined;
  if (condition !== undefined) {
    return {
      type: value.type,
      ...(relation === undefined ? {} : { relation }),
      ...(wildcard ? { wildcard: true } : {}),
      condition,
    };
  }
  if (relation !== undefined) return `${value.type}#${relation}`;
  if (wildcard) return `${value.type}:*`;
  return value.type;
}

function conditionParameterType(value: unknown, path: string): string {
  const typeName = record(value, path).type_name;
  if (typeof typeName !== 'string' || !typeName.startsWith('TYPE_NAME_')) {
    throw new Error(
      `${path}.type_name is not a recognized OpenFGA condition type`,
    );
  }
  return typeName.slice('TYPE_NAME_'.length).toLowerCase();
}

function translateCelFixtureExpression(
  expression: string,
  parameters: Readonly<Record<string, string>>,
): string {
  let translated = expression
    .replace(
      /\b([A-Za-z_][A-Za-z0-9_]*)\.in_cidr\(([A-Za-z_][A-Za-z0-9_]*)\)/g,
      (_match, address: string, cidr: string) =>
        `ip_in_cidr(.context.${address}; .context.${cidr})`,
    )
    .replace(/timestamp\(("(?:[^"\\]|\\.)*")\)/g, '$1')
    .replace(/\|\|/g, ' or ')
    .replace(/&&/g, ' and ');

  for (const parameter of Object.keys(parameters).sort(
    (left, right) => right.length - left.length,
  )) {
    translated = translated.replace(
      new RegExp(`(?<![A-Za-z0-9_.])${parameter}\\b`, 'g'),
      `.context.${parameter}`,
    );
  }
  return translated;
}

export function convertOpenFgaDslToBxlModel(
  dsl: string,
): AuthorizationGraphModel {
  const upstream = transformer.transformDSLToJSONObject(
    dsl,
  ) as unknown as JsonRecord;
  const definitions = upstream.type_definitions;
  if (!Array.isArray(definitions))
    throw new Error('type_definitions must be an array');

  const types: Record<
    string,
    {
      relations: Record<string, AuthorizationGraphRelationDefinition>;
      permissions: Record<string, string>;
    }
  > = {};
  // Built up entry by entry, then handed back as the model's readonly shape.
  const conditions: Record<
    string,
    NonNullable<AuthorizationGraphModel['conditions']>[string]
  > = {};

  const upstreamConditions = record(upstream.conditions ?? {}, 'conditions');
  for (const [name, rawCondition] of Object.entries(upstreamConditions)) {
    const condition = record(rawCondition, `conditions.${name}`);
    if (typeof condition.expression !== 'string') {
      throw new Error(`conditions.${name}.expression must be a string`);
    }
    const rawParameters = record(
      condition.parameters ?? {},
      `conditions.${name}.parameters`,
    );
    const parameters = Object.fromEntries(
      Object.entries(rawParameters).map(([parameter, type]) => [
        parameter,
        conditionParameterType(
          type,
          `conditions.${name}.parameters.${parameter}`,
        ),
      ]),
    );
    conditions[name] = {
      expression: translateCelFixtureExpression(
        condition.expression,
        parameters,
      ),
      parameters,
    };
  }

  for (let typeIndex = 0; typeIndex < definitions.length; typeIndex++) {
    const definition = record(
      definitions[typeIndex],
      `type_definitions[${typeIndex}]`,
    );
    if (typeof definition.type !== 'string' || definition.type === '') {
      throw new Error(
        `type_definitions[${typeIndex}].type must be a non-empty string`,
      );
    }
    const relations = record(
      definition.relations ?? {},
      `type_definitions[${typeIndex}].relations`,
    );
    const metadata =
      definition.metadata == null
        ? {}
        : record(
            definition.metadata,
            `type_definitions[${typeIndex}].metadata`,
          );
    const relationMetadata =
      metadata.relations == null
        ? {}
        : record(
            metadata.relations,
            `type_definitions[${typeIndex}].metadata.relations`,
          );
    const converted = {
      relations: {} as Record<string, AuthorizationGraphRelationDefinition>,
      permissions: {} as Record<string, string>,
    };

    for (const [name, rewrite] of Object.entries(relations)) {
      const relationMeta =
        relationMetadata[name] == null
          ? {}
          : record(
              relationMetadata[name],
              `type_definitions[${typeIndex}].metadata.relations.${name}`,
            );
      const directTypes = relationMeta.directly_related_user_types;
      const subjects = Array.isArray(directTypes)
        ? directTypes.map((reference, index) =>
            subjectConstraint(
              reference,
              `type_definitions[${typeIndex}].metadata.relations.${name}.directly_related_user_types[${index}]`,
            ),
          )
        : [];
      const expression = openFgaRewriteToBxl(
        rewrite,
        `type_definitions[${typeIndex}].relations.${name}`,
      );
      if (subjects.length > 0) {
        converted.relations[name] = { subjects, rewrite: expression };
      } else {
        converted.permissions[name] = expression;
      }
    }
    types[definition.type] = converted;
  }

  return {
    schema: 'bxl-authorization-ir/1',
    types,
    ...(Object.keys(conditions).length === 0 ? {} : { conditions }),
  };
}

function convertTuple(tuple: UpstreamTuple): RelationshipTuple {
  return {
    subject: tuple.user,
    relation: tuple.relation,
    object: tuple.object,
    ...(tuple.condition
      ? {
          condition: {
            name: tuple.condition.name,
            ...(tuple.condition.context
              ? { context: tuple.condition.context }
              : {}),
          },
        }
      : {}),
  };
}

function addFailure(
  report: OpenFgaConformanceReport,
  failure: OpenFgaConformanceFailure,
): void {
  if (report.failures.length < 100) report.failures.push(failure);
}

function sameStringSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  if (actual.length !== expected.length) return false;
  const expectedSorted = [...expected].sort();
  return [...actual]
    .sort()
    .every((value, index) => value === expectedSorted[index]);
}

export interface OpenFgaFixtureSource {
  path: string;
  source: string;
}

/**
 * Pure conformance runner shared by Node and the browser harness. The caller
 * owns fixture integrity checks; this function owns parsing, translation,
 * model preparation, execution, and zero-skip assertion accounting.
 */
export function runOpenFgaConformanceFixtures(
  fixtureSources: readonly OpenFgaFixtureSource[],
): OpenFgaConformanceReport {
  const report: OpenFgaConformanceReport = {
    discovered: 0,
    passed: 0,
    failed: 0,
    importerFailures: 0,
    unsupported: 0,
    check: {
      discovered: 0,
      passed: 0,
      failed: 0,
      importerFailures: 0,
      unsupported: 0,
    },
    listObjects: {
      discovered: 0,
      passed: 0,
      failed: 0,
      importerFailures: 0,
      unsupported: 0,
    },
    listUsers: {
      discovered: 0,
      passed: 0,
      failed: 0,
      importerFailures: 0,
      unsupported: 0,
    },
    failures: [],
  };

  for (const fixtureSource of fixtureSources) {
    const manifestFile = { path: fixtureSource.path };
    const fixture = parse(fixtureSource.source) as UpstreamFixture;
    for (const test of fixture.tests) {
      const storedTuples: RelationshipTuple[] = [];
      for (let stageIndex = 0; stageIndex < test.stages.length; stageIndex++) {
        const stage = test.stages[stageIndex]!;
        storedTuples.push(...(stage.tuples ?? []).map(convertTuple));
        const assertions = stage.checkAssertions ?? [];
        const listObjectsAssertions = stage.listObjectsAssertions ?? [];
        const listUsersAssertions = stage.listUsersAssertions ?? [];
        const stageAssertionCount =
          assertions.length +
          listObjectsAssertions.length +
          listUsersAssertions.length;
        report.discovered += stageAssertionCount;
        report.check.discovered += assertions.length;
        report.listObjects.discovered += listObjectsAssertions.length;
        report.listUsers.discovered += listUsersAssertions.length;
        let model: AuthorizationGraphModel;
        try {
          model = convertOpenFgaDslToBxlModel(stage.model);
        } catch (error) {
          report.importerFailures += stageAssertionCount;
          report.check.importerFailures += assertions.length;
          report.listObjects.importerFailures += listObjectsAssertions.length;
          report.listUsers.importerFailures += listUsersAssertions.length;
          addFailure(report, {
            fixture: manifestFile.path,
            test: test.name,
            stage: stageIndex,
            kind: 'importer',
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        const prepared = prepareAuthorizationGraphSafe(model, storedTuples, {
          invalidTuplePolicy: 'ignore',
        });
        if (!prepared.ok) {
          report.importerFailures += stageAssertionCount;
          report.check.importerFailures += assertions.length;
          report.listObjects.importerFailures += listObjectsAssertions.length;
          report.listUsers.importerFailures += listUsersAssertions.length;
          addFailure(report, {
            fixture: manifestFile.path,
            test: test.name,
            stage: stageIndex,
            kind: 'importer',
            message: `${prepared.error.kind}: ${prepared.error.message}`,
          });
          continue;
        }

        for (
          let assertionIndex = 0;
          assertionIndex < assertions.length;
          assertionIndex++
        ) {
          const assertion = assertions[assertionIndex]!;
          const tuple = assertion.tuple;
          const result = prepared.value.check({
            subject: tuple?.user ?? '',
            relation: tuple?.relation ?? '',
            object: tuple?.object ?? '',
            ...(assertion.context ? { context: assertion.context } : {}),
            ...(assertion.contextualTuples
              ? {
                  contextualTuples:
                    assertion.contextualTuples.map(convertTuple),
                }
              : {}),
          });

          if (!result.ok && result.error.kind === 'unsupported-expression') {
            report.unsupported++;
            report.check.unsupported++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: 'unsupported',
              message: result.error.message,
            });
            continue;
          }

          if ((assertion.errorCode ?? 0) !== 0) {
            if (!result.ok) {
              report.passed++;
              report.check.passed++;
            } else {
              report.failed++;
              report.check.failed++;
              addFailure(report, {
                fixture: manifestFile.path,
                test: test.name,
                stage: stageIndex,
                assertion: assertionIndex,
                kind: 'error',
                message: `expected error ${assertion.errorCode}, received decision ${result.value.allowed}`,
              });
            }
            continue;
          }

          if (result.ok && result.value.allowed === assertion.expectation) {
            report.passed++;
            report.check.passed++;
          } else {
            report.failed++;
            report.check.failed++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: result.ok ? 'decision' : 'error',
              message: result.ok
                ? `expected ${String(assertion.expectation)}, received ${String(result.value.allowed)}`
                : `${result.error.kind}: ${result.error.message}`,
            });
          }
        }

        for (
          let assertionIndex = 0;
          assertionIndex < listObjectsAssertions.length;
          assertionIndex++
        ) {
          const assertion = listObjectsAssertions[assertionIndex]!;
          const result = prepared.value.listObjects({
            subject: assertion.request.user,
            type: assertion.request.type,
            relation: assertion.request.relation,
            ...(assertion.context ? { context: assertion.context } : {}),
            ...(assertion.contextualTuples
              ? {
                  contextualTuples:
                    assertion.contextualTuples.map(convertTuple),
                }
              : {}),
          });

          if (!result.ok && result.error.kind === 'unsupported-expression') {
            report.unsupported++;
            report.listObjects.unsupported++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: 'unsupported',
              message: result.error.message,
            });
          } else if ((assertion.errorCode ?? 0) !== 0) {
            if (!result.ok) {
              report.passed++;
              report.listObjects.passed++;
            } else {
              report.failed++;
              report.listObjects.failed++;
              addFailure(report, {
                fixture: manifestFile.path,
                test: test.name,
                stage: stageIndex,
                assertion: assertionIndex,
                kind: 'error',
                message: `expected error ${assertion.errorCode}, received ${JSON.stringify(result.value.objects)}`,
              });
            }
          } else if (
            result.ok &&
            sameStringSet(result.value.objects, assertion.expectation ?? [])
          ) {
            report.passed++;
            report.listObjects.passed++;
          } else {
            report.failed++;
            report.listObjects.failed++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: result.ok ? 'decision' : 'error',
              message: result.ok
                ? `expected ${JSON.stringify(assertion.expectation ?? [])}, received ${JSON.stringify(result.value.objects)}`
                : `${result.error.kind}: ${result.error.message}`,
            });
          }
        }

        for (
          let assertionIndex = 0;
          assertionIndex < listUsersAssertions.length;
          assertionIndex++
        ) {
          const assertion = listUsersAssertions[assertionIndex]!;
          const result = prepared.value.listUsers({
            object: assertion.request.object,
            relation: assertion.request.relation,
            filters: assertion.request.filters,
            ...(assertion.context ? { context: assertion.context } : {}),
            ...(assertion.contextualTuples
              ? {
                  contextualTuples:
                    assertion.contextualTuples.map(convertTuple),
                }
              : {}),
          });

          if (!result.ok && result.error.kind === 'unsupported-expression') {
            report.unsupported++;
            report.listUsers.unsupported++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: 'unsupported',
              message: result.error.message,
            });
          } else if ((assertion.errorCode ?? 0) !== 0) {
            if (!result.ok) {
              report.passed++;
              report.listUsers.passed++;
            } else {
              report.failed++;
              report.listUsers.failed++;
              addFailure(report, {
                fixture: manifestFile.path,
                test: test.name,
                stage: stageIndex,
                assertion: assertionIndex,
                kind: 'error',
                message: `expected error ${assertion.errorCode}, received ${JSON.stringify(result.value.users)}`,
              });
            }
          } else if (
            result.ok &&
            sameStringSet(result.value.users, assertion.expectation ?? [])
          ) {
            report.passed++;
            report.listUsers.passed++;
          } else {
            report.failed++;
            report.listUsers.failed++;
            addFailure(report, {
              fixture: manifestFile.path,
              test: test.name,
              stage: stageIndex,
              assertion: assertionIndex,
              kind: result.ok ? 'decision' : 'error',
              message: result.ok
                ? `expected ${JSON.stringify(assertion.expectation ?? [])}, received ${JSON.stringify(result.value.users)}`
                : `${result.error.kind}: ${result.error.message}`,
            });
          }
        }
      }
    }
  }

  const classified =
    report.passed +
    report.failed +
    report.importerFailures +
    report.unsupported;
  if (classified !== report.discovered) {
    throw new Error(
      `Conformance accounting error: discovered ${report.discovered}, classified ${classified}.`,
    );
  }
  return report;
}
