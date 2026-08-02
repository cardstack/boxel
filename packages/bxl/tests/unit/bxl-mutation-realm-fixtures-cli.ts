import {
  mutationSchemaFixtures,
  realmMutationExamples,
} from '../../examples/bxl-mutation-examples.js';
import { verifyMutationFixture } from '../../examples/bxl-mutation-fixture-runner.js';

if (realmMutationExamples.length < 6) {
  throw new Error(`Expected at least 6 realm-shaped mutation fixtures, received ${realmMutationExamples.length}`);
}

const missingEvidence = realmMutationExamples.filter((fixture) => {
  const schema = mutationSchemaFixtures[fixture.schema];
  return !('sourceEvidence' in schema) || typeof schema.sourceEvidence !== 'string';
});
if (missingEvidence.length > 0) {
  throw new Error(`Realm mutation fixtures lack source evidence: ${missingEvidence.map((fixture) => fixture.id).join(', ')}`);
}

const nonportableEvidence = realmMutationExamples.filter((fixture) => {
  const schema = mutationSchemaFixtures[fixture.schema];
  const evidence = 'sourceEvidence' in schema ? schema.sourceEvidence : '';
  return evidence.startsWith('/') || evidence.startsWith('~') || evidence.includes('/Users/');
});
if (nonportableEvidence.length > 0) {
  throw new Error(`Realm mutation source evidence must be workspace-relative: ${nonportableEvidence.map((fixture) => fixture.id).join(', ')}`);
}

const results = realmMutationExamples.map(verifyMutationFixture);
const failed = results.filter((result) => !result.passed);
if (failed.length > 0) {
  throw new Error(
    `Realm mutation fixture verification failed:\n${failed
      .map((result) => `${result.fixtureId}: ${result.error ?? 'failed'}`)
      .join('\n')}`,
  );
}

const accepted = realmMutationExamples.filter((fixture) => fixture.outcome === 'accepted').length;
const rejected = realmMutationExamples.length - accepted;
if (accepted < 4 || rejected < 2) {
  throw new Error(`Realm mutation seam must retain accepted writes and rejected boundaries; received ${accepted}/${rejected}`);
}
const rejectionCodes = new Set(
  realmMutationExamples.flatMap((fixture) => fixture.outcome === 'rejected' ? [fixture.error.code] : []),
);
for (const requiredCode of ['storage-projection-forbidden', 'field-read-only']) {
  if (!rejectionCodes.has(requiredCode)) {
    throw new Error(`Realm mutation seam must retain ${requiredCode}`);
  }
}
console.log(
  `BXL realm-shaped mutation fixtures: ${realmMutationExamples.length} cases passed (${accepted} accepted, ${rejected} rejected)`,
);
