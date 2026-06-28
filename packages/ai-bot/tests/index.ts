import './qunit-bootstrap.ts'; // configures QUnit before any test registers
import QUnit from 'qunit';
import '../setup-logger.ts'; // This should be first
import './response-parsing-test.ts';
import './history-construction-test.ts';
import './prompt-construction-test.ts';
import './code-patch-correctness-test.ts';
import './chat-titling-test.ts';
import './responding-test.ts';
import './matrix-util-test.ts';
import './modality-test.ts';
import './locking-test.ts';
import './interrupt-test.ts';
import './credit-tracking-test.ts';
import './user-delegated-realm-server-session-test.ts';

QUnit.start();
