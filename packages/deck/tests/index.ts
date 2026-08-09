// Test entry: mirrors the monorepo pattern of running qunit files directly
// under node (`node tests/index.ts`), TAP output, nonzero exit on failure.
import QUnitDefault from 'qunit';

// @types/qunit lags the Node API surface (reporters, on); narrow locally.
const QUnit = QUnitDefault as typeof QUnitDefault & {
  reporters: { tap: { init(qunit: unknown): void } };
  on(
    event: 'runEnd',
    callback: (runEnd: { testCounts: { failed: number } }) => void,
  ): void;
};

QUnit.config.autostart = false;
QUnit.reporters.tap.init(QUnit);
QUnit.on('runEnd', (runEnd) => {
  if (runEnd.testCounts.failed > 0) {
    process.exitCode = 1;
  }
});

await import('./tree-hash-test.ts');
await import('./pack-test.ts');
await import('./store-test.ts');
await import('./es-lexer-test.ts');
await import('./import-map-test.ts');
await import('./inherit-test.ts');
await import('./classify-test.ts');
await import('./provenance-test.ts');
await import('./pack-mode-test.ts');
await import('./pack-hermetic-test.ts');
await import('./entries-test.ts');
await import('./vendor-test.ts');
await import('./source-graph-test.ts');
await import('./lock-test.ts');
await import('./fork-test.ts');
await import('./merge-test.ts');
await import('./offer-test.ts');
await import('./signature-test.ts');
await import('./verify-links-test.ts');

QUnit.start();
