import QUnitDefault from 'qunit';

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

await import('./deckd-test.ts');
await import('./deckd-live-test.ts');

QUnit.start();
