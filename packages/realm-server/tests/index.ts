(globalThis as any).__environment = 'test';
import 'decorator-transforms/globals';
import '../setup-logger'; // This should be first
import './auth-client-test';
import './index-query-engine-test';
import './index-writer-test';
import './indexing-test';
import './loader-test';
import './module-syntax-test';
import './permissions/permission-checker-test';
import './queue-test';
import './realm-server-test';
import './virtual-network-test';
import './billing-test';

// There is some timer that is preventing the node process from ending promptly.
// This forces the test to end with the correct response code. Note that a
// message "Error: Process exited before tests finished running" will be
// displayed because of this approach.
import QUnit from 'qunit';
(QUnit as any).on(
  'runEnd',
  ({
    testCounts,
  }: {
    testCounts: {
      passed: number;
      failed: number;
      total: number;
      skipped: number;
      todo: number;
    };
  }) => {
    if (testCounts.failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  },
);
