// Configures QUnit to run under native Node (`node tests/index.ts`): autostart
// off so `index.ts` registers every test before starting, the TAP reporter,
// and an exit code from the failure count.
import QUnit from 'qunit';

QUnit.config.autostart = false;
(QUnit as any).reporters.tap.init(QUnit); // QUnit 2.x API missing from @types/qunit
(QUnit as any).on('runEnd', (data: { testCounts: { failed: number } }) => {
  process.exitCode = data.testCounts.failed > 0 ? 1 : 0;
});
