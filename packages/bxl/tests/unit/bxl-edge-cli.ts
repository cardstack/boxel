import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateBxl, lintBxlExpression } from '../../src/index.js';
import {
  bxlEdgeExampleInput,
  bxlEdgeExampleSchema,
  bxlEdgeExamples,
} from '../../examples/bxl-edge-examples.js';

interface Failure {
  id: number;
  level: string;
  name: string;
  expression: string;
  error: unknown;
}

const failures: Failure[] = [];

for (const example of bxlEdgeExamples) {
  try {
    const lint = lintBxlExpression(example.expression, {
      schema: bxlEdgeExampleSchema,
    });
    const issueCodes = lint.issues.map((issue) => issue.code);

    for (const code of example.expectIssueCodes ?? []) {
      strictEqual(
        issueCodes.includes(code),
        true,
        `${example.name} should report ${code}`,
      );
    }

    if (example.expectError) {
      strictEqual(
        lint.issues.length > 0 || !lint.ok,
        true,
        `${example.name} should report a warning or error`,
      );
      continue;
    }

    strictEqual(lint.ok, true, example.name);

    const result = evaluateBxl(example.expression, bxlEdgeExampleInput, {
      schema: bxlEdgeExampleSchema,
    });
    deepStrictEqual(result.value, example.expected, example.name);
  } catch (error) {
    failures.push({
      id: example.id,
      level: example.level,
      name: example.name,
      expression: example.expression,
      error,
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n#${failure.id} ${failure.level}: ${failure.name}`);
    console.error(`expression: ${failure.expression}`);
    console.error(failure.error);
  }
  throw new Error(
    `BXL edge examples failed: ${failures.length} of ${bxlEdgeExamples.length}`,
  );
}

console.log(`BXL edge examples: ${bxlEdgeExamples.length} cases passed`);
