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
