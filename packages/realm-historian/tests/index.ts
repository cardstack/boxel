import './qunit-bootstrap.ts'; // configures QUnit before any test registers
import QUnit from 'qunit';
import '../setup-logger.ts';
import './git-objects-test.ts';
import './repo-format-test.ts';
import './head-tree-test.ts';
import './grouper-test.ts';
import './semaphore-test.ts';
import './lease-test.ts';
import './consumer-test.ts';
import './health-test.ts';
import './historian-test.ts';
import './recorder-test.ts';
import './background-test.ts';
import './maintenance-test.ts';
import './reader-test.ts';
import './process-test.ts';
import './scan-test.ts';

QUnit.start();
