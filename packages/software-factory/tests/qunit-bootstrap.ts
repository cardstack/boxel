// Configures QUnit to run under native Node (`node tests/index.ts`). The qunit
// CLI used to provide these three things; running the suite directly under node
// means wiring them up ourselves:
//   - autostart off, so `index.ts` can register every test before starting
//   - the TAP reporter the CLI emitted by default
//   - a failure-based process exit code
import QUnit from 'qunit';

QUnit.config.autostart = false;
QUnit.reporters.tap.init(QUnit);
QUnit.on('runEnd', (data) => {
  process.exitCode = data.testCounts.failed > 0 ? 1 : 0;
});
