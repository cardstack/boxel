import { verifyMutationCorpus } from '../../examples/bxl-mutation-fixture-runner.ts';

const result = verifyMutationCorpus();
const failedFixtures = result.results.filter((fixture) => !fixture.passed);

if (!result.passed) {
  const failures = [
    ...failedFixtures.map(
      (fixture) => `${fixture.fixtureId}: ${fixture.error ?? 'failed'}`,
    ),
    ...result.errors.map((error) => `corpus: ${error}`),
  ];
  throw new Error(
    `BXL mutation fixture verification failed:\n${failures.join('\n')}`,
  );
}

console.log(
  `BXL mutation fixtures: ${result.results.length} cases passed (${result.accepted} accepted, ${result.rejected} rejected, ${result.readableSolidifications} readable solidifications, ${result.groups} groups)`,
);
