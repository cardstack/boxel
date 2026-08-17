import { runOpenFgaConformance } from '../tests/authorization/support/openfga-conformance.ts';
import { OPENFGA_FIXTURE_COMMIT } from '../tests/authorization/support/openfga-fixtures.ts';

try {
  const report = runOpenFgaConformance();
  console.log(`OpenFGA semantic conformance @ ${OPENFGA_FIXTURE_COMMIT}`);
  console.log(
    `discovered=${report.discovered} passed=${report.passed} failed=${report.failed} ` +
      `importer_failures=${report.importerFailures} unsupported=${report.unsupported}`,
  );
  console.log(
    `Check=${report.check.passed}/${report.check.discovered} ` +
      `(failed=${report.check.failed} importer=${report.check.importerFailures} unsupported=${report.check.unsupported})`,
  );
  console.log(
    `ListObjects=${report.listObjects.passed}/${report.listObjects.discovered} ` +
      `(failed=${report.listObjects.failed} importer=${report.listObjects.importerFailures} unsupported=${report.listObjects.unsupported})`,
  );
  console.log(
    `ListUsers=${report.listUsers.passed}/${report.listUsers.discovered} ` +
      `(failed=${report.listUsers.failed} importer=${report.listUsers.importerFailures} unsupported=${report.listUsers.unsupported})`,
  );

  for (const failure of report.failures.slice(0, 20)) {
    const location = [
      failure.fixture,
      failure.test,
      `stage ${failure.stage}`,
      ...(failure.assertion === undefined
        ? []
        : [`assertion ${failure.assertion}`]),
    ].join(' > ');
    console.log(`- ${failure.kind}: ${location}: ${failure.message}`);
  }
  if (report.failures.length > 20) {
    console.log(`- ... ${report.failures.length - 20} more sampled failures`);
  }

  if (
    report.failed > 0 ||
    report.importerFailures > 0 ||
    report.unsupported > 0
  ) {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    error instanceof Error ? (error.stack ?? error.message) : String(error),
  );
  process.exitCode = 1;
}
