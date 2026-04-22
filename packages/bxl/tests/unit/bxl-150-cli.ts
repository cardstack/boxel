import { deepStrictEqual, strictEqual } from 'node:assert';
import { evaluateBxl } from '../../src/index.js';
import {
  bxlExampleInput,
  bxlExamples,
  bxlExampleSchema,
} from '../../examples/bxl-150-examples.js';

interface Failure {
  id: number;
  name: string;
  expression: string;
  compiledSource?: string;
  error: unknown;
}

const failures: Failure[] = [];

for (const example of bxlExamples) {
  try {
    const result = evaluateBxl(example.expression, bxlExampleInput, {
      schema: bxlExampleSchema,
    });

    strictEqual(
      result.warnings.length,
      0,
      `example ${example.id} should compile without warnings`,
    );
    strictEqual(result.compiledSource, example.compiled, example.name);
    deepStrictEqual(result.value, example.expected, example.name);
  } catch (error) {
    let compiledSource: string | undefined;
    try {
      compiledSource = evaluateBxl(example.expression, bxlExampleInput, {
        schema: bxlExampleSchema,
      }).compiledSource;
    } catch {
      compiledSource = undefined;
    }

    failures.push({
      id: example.id,
      name: example.name,
      expression: example.expression,
      compiledSource,
      error,
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n#${failure.id}: ${failure.name}`);
    console.error(`expression: ${failure.expression}`);
    if (failure.compiledSource) {
      console.error(`compiled: ${failure.compiledSource}`);
    }
    console.error(failure.error);
  }

  throw new Error(
    `BXL 150 examples failed: ${failures.length} of ${bxlExamples.length}`,
  );
}

console.log(`BXL 150 examples: ${bxlExamples.length} cases passed`);
