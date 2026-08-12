import { verifyOpenFgaFixtureInventory } from '../tests/authorization/support/openfga-fixtures.js';

try {
  const { manifest, counts } = verifyOpenFgaFixtureInventory();
  console.log(
    [
      `OpenFGA fixtures verified at ${manifest.source.commit}`,
      `${counts.tests} tests / ${counts.stages} stages`,
      `${counts.checkAssertions} Check`,
      `${counts.listObjectsAssertions} ListObjects`,
      `${counts.listUsersAssertions} ListUsers`,
      `${counts.assertions} total assertions`,
    ].join('; '),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
