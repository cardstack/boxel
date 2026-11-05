import './qunit-bootstrap.ts'; // configures QUnit before any test registers
import QUnit from 'qunit';
import '../setup-logger.ts';
import './git-objects-test.ts';
import './repo-format-test.ts';
import './lease-test.ts';
import './consumer-test.ts';
import './health-test.ts';
import './historian-test.ts';
import './process-test.ts';

QUnit.start();
