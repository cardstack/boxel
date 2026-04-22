import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { evaluateBxl } from '../../src/index.js';
import {
  bxlFormulaExampleInput,
  bxlFormulaExamples,
  bxlFormulaExampleSchema,
} from '../../examples/bxl-formula-examples.js';

interface Failure {
  id: number;
  name: string;
  expression: string;
  compiledSource?: string;
  error: unknown;
}

const failures: Failure[] = [];

for (const example of bxlFormulaExamples) {
  try {
    const result = evaluateBxl(example.expression, bxlFormulaExampleInput, {
      schema: bxlFormulaExampleSchema,
    });

    strictEqual(
      result.warnings.length,
      0,
      `example ${example.id} should compile without warnings`,
    );

    if (typeof example.expected === 'number' && example.tolerance !== undefined) {
      ok(
        typeof result.value === 'number' &&
          Math.abs(result.value - example.expected) <= example.tolerance,
        `${example.name}: expected ${example.expected} +/- ${example.tolerance}, got ${result.value}`,
      );
    } else {
      deepStrictEqual(result.value, example.expected, example.name);
    }
  } catch (error) {
    let compiledSource: string | undefined;
    try {
      compiledSource = evaluateBxl(
        example.expression,
        bxlFormulaExampleInput,
        { schema: bxlFormulaExampleSchema },
      ).compiledSource;
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
    `BXL formula examples failed: ${failures.length} of ${bxlFormulaExamples.length}`,
  );
}

console.log(`BXL formula examples: ${bxlFormulaExamples.length} cases passed`);
