// Run the BSL-primer BXL-context examples through the full compile + evaluate
// pipeline. Asserts each example's expected value and captures the compiled
// canonical jq source on failure for debugging.

import { deepStrictEqual } from 'node:assert';
import { evaluateBxl } from '../../src/index.js';
import {
  bxlContextExampleInput,
  bxlContextExampleSchema,
  bxlContextExamples,
  type BxlContext,
} from '../../examples/bxl-contexts-examples.js';

interface Failure {
  id: number;
  context: BxlContext;
  name: string;
  expression: string;
  compiledSource?: string;
  error: unknown;
}

const failures: Failure[] = [];
const perContext = new Map<BxlContext, number>();

for (const example of bxlContextExamples) {
  perContext.set(example.context, (perContext.get(example.context) ?? 0) + 1);

  try {
    const result = evaluateBxl(example.expression, bxlContextExampleInput, {
      schema: bxlContextExampleSchema,
    });

    if (
      typeof example.tolerance === 'number' &&
      typeof result.value === 'number' &&
      typeof example.expected === 'number'
    ) {
      if (Math.abs(result.value - example.expected) > example.tolerance) {
        throw new Error(
          `value ${result.value} differs from expected ${example.expected} by more than tolerance ${example.tolerance}`,
        );
      }
    } else {
      deepStrictEqual(
        result.value,
        example.expected,
        `[${example.context}] ${example.name}`,
      );
    }
  } catch (error) {
    let compiledSource: string | undefined;
    try {
      compiledSource = evaluateBxl(example.expression, bxlContextExampleInput, {
        schema: bxlContextExampleSchema,
      }).compiledSource;
    } catch {
      compiledSource = undefined;
    }

    failures.push({
      id: example.id,
      context: example.context,
      name: example.name,
      expression: example.expression,
      compiledSource,
      error,
    });
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n#${failure.id}  [${failure.context}]  ${failure.name}`);
    console.error(`  expression: ${failure.expression}`);
    if (failure.compiledSource) {
      console.error(`  compiled:   ${failure.compiledSource}`);
    }
    console.error(`  ${failure.error}`);
  }

  throw new Error(
    `BXL context examples failed: ${failures.length} of ${bxlContextExamples.length}`,
  );
}

const summary = [...perContext.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([ctx, n]) => `${ctx}×${n}`)
  .join(' · ');

console.log(`BXL context examples: ${bxlContextExamples.length} cases passed (${summary})`);
