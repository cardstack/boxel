(globalThis as any).__environment = 'test';

// Ensure test timeouts don't hold the Node event loop open. Wrap setTimeout to
// unref timers so the process can exit once work is done. This does have the
// effect of masking any issues where code should be clearing timers, however
// the tradeoff is that server tests finish immediately instead of getting into
// situations where they hang until CI times out.
{
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    const handle = originalSetTimeout(...args);
    if (typeof (handle as any)?.unref === 'function') {
      (handle as any).unref();
    }
    return handle;
  }) as typeof setTimeout;
}

import * as ContentTagGlobal from 'content-tag';
(globalThis as any).ContentTagGlobal = ContentTagGlobal;

import QUnit from 'qunit';

QUnit.config.testTimeout = 60000;

import 'decorator-transforms/globals';
import '../setup-logger'; // This should be first
import './atomic-endpoints-test';
import './auth-client-test';
import './billing-test';
import './card-dependencies-endpoint-test';
import './card-endpoints-test';
import './card-source-endpoints-test';
import './definition-lookup-test';
import './file-watcher-events-test';
import './indexing-test';
import './module-syntax-test';
import './permissions/permission-checker-test';
import './prerendering-test';
import './prerender-server-test';
import './prerender-manager-test';
import './queue-test';
import './realm-endpoints-test';
import './realm-endpoints/dependencies-test';
import './realm-endpoints/directory-test';
import './realm-endpoints/info-test';
import './realm-endpoints/lint-test';
import './realm-endpoints/mtimes-test';
import './realm-endpoints/permissions-test';
import './realm-endpoints/publishability-test';
import './realm-endpoints/search-test';
import './realm-endpoints/user-test';
import './search-prerendered-test';
import './server-endpoints-test';
import './transpile-test';
import './types-endpoint-test';
import './virtual-network-test';
import './request-forward-test';
import './publish-unpublish-realm-test';
import './boxel-domain-availability-test';
import './get-boxel-claimed-domain-test';
import './claim-boxel-domain-test';
import './delete-boxel-claimed-domain-test';
import './realm-auth-test';
import './queries-test';
import './remote-prerenderer-test';
