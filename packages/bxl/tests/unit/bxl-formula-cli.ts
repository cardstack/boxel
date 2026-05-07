import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { runNativeJqAsync } from '../../src/index.js';
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

// The `formula` namespace covers the eager core. Engineering, financial,
// dateSerial, statistical, and bessel families are lazy chunks loaded on
// demand by the async runtime — this test goes through `runNativeJqAsync`
// so each example's auto-loader fires when the expression references one.
for (const example of bxlFormulaExamples) {
  try {
    const result = await runNativeJqAsync(
      example.expression,
      bxlFormulaExampleInput,
      { schema: bxlFormulaExampleSchema },
    );
    const value =
      result.outputs.length === 1
        ? result.outputs[0]
        : result.outputs.length === 0
          ? null
          : result.outputs;

    strictEqual(
      result.readableWarnings.length,
      0,
      `example ${example.id} should compile without warnings`,
    );

    if (typeof example.expected === 'number' && example.tolerance !== undefined) {
      ok(
        typeof value === 'number' &&
          Math.abs(value - example.expected) <= example.tolerance,
        `${example.name}: expected ${example.expected} +/- ${example.tolerance}, got ${value}`,
      );
    } else {
      deepStrictEqual(value, example.expected, example.name);
    }
  } catch (error) {
    let compiledSource: string | undefined;
    try {
      compiledSource = (
        await runNativeJqAsync(
          example.expression,
          bxlFormulaExampleInput,
          { schema: bxlFormulaExampleSchema },
        )
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
