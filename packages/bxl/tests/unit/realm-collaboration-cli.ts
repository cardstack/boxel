// Real-world regression corpus from stack.cards/ctse/realm-collaboration.
// Every example is profile-validated, evaluated in raw-jq mode, and required
// to produce exactly one value of the appropriate gateway shape.

import { deepStrictEqual, strictEqual } from 'node:assert';
import { compileBxl, evaluateBxl } from '../../src/index.js';
import {
  realmCollaborationExamples,
  realmCollaborationInventory,
} from '../../examples/realm-collaboration-examples.js';

const inventoryTotal = Object.values(
  realmCollaborationInventory.bySource,
).reduce((sum, count) => sum + count, 0);
strictEqual(
  inventoryTotal,
  realmCollaborationInventory.staticDeclarations,
  'source inventory must add up to the audited declaration count',
);
strictEqual(
  realmCollaborationInventory.byProfile.policy +
    realmCollaborationInventory.byProfile.derive,
  realmCollaborationInventory.staticDeclarations,
  'profile inventory must add up to the audited declaration count',
);

const failures: string[] = [];
const stages = new Set<string>();
const useCases = new Set<string>();

for (const example of realmCollaborationExamples) {
  stages.add(example.stage);
  useCases.add(example.useCase);

  try {
    const program = compileBxl(example.expression, {
      target: 'ast',
      profile: example.profile,
      attachment: example.attachment,
      readableSyntax: example.readableSyntax ?? false,
      schema: example.schema,
    });
    const profileErrors = program.profileIssues.filter(
      (issue) => issue.severity === 'error',
    );
    deepStrictEqual(
      profileErrors,
      [],
      `${example.id} must satisfy the ${example.profile} profile`,
    );

    const result = evaluateBxl(example.expression, example.input, {
      readableSyntax: example.readableSyntax ?? false,
      schema: example.schema,
      runtimeLimits: {
        maxSteps: 10_000,
        maxMillis: 25,
        maxOutputs: 1,
        maxOutputBytes: 64 * 1024,
      },
    });
    strictEqual(result.outputs.length, 1, `${example.id} must emit one value`);
    deepStrictEqual(result.value, example.expected, example.id);

    if (example.stage === 'admission') {
      strictEqual(
        typeof result.value,
        'boolean',
        `${example.id} admission must emit Boolean`,
      );
    }
    if (
      example.stage === 'state-transition' ||
      example.stage === 'clock-transition' ||
      example.stage === 'event-projection'
    ) {
      strictEqual(
        result.value !== null && typeof result.value === 'object',
        true,
        `${example.id} transition/projection must emit an object or array`,
      );
    }
  } catch (error) {
    failures.push(
      `${example.id} (${example.sourceRef}): ${
        error instanceof Error ? error.stack ?? error.message : String(error)
      }`,
    );
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n\n'));
  throw new Error(
    `realm-collaboration corpus failed: ${failures.length}/${realmCollaborationExamples.length}`,
  );
}

deepStrictEqual(
  [...stages].sort(),
  [
    'admission',
    'clock-transition',
    'decision-test',
    'event-projection',
    'rejection-reason',
    'state-transition',
  ],
  'the corpus must retain every observed evaluation stage',
);

console.log(
  `Realm collaboration: ${realmCollaborationExamples.length} cases passed across ${useCases.size} use cases and ${stages.size} stages (live inventory: ${realmCollaborationInventory.staticDeclarations} static declarations)`,
);
