import './qunit-bootstrap.ts'; // configures QUnit before any test registers
import QUnit from 'qunit';
import '../setup-logger.ts';
import './bot-runner-test.ts';
import './command-runner-test.ts';
import './create-listing-pr-handler-test.ts';
import './lint-runner-test.ts';

QUnit.start();
