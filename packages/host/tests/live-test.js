import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { getService } from '@universal-ember/test-support';
import { useTestWaiters } from '@cardstack/runtime-common';
import * as TestWaiters from '@ember/test-waiters';

// Guard: embroider includes all tests/** files in the normal test bundle.
// When loaded there, window.__LIVE_TEST__ is absent — bail out immediately.
if (window.__LIVE_TEST__) {
  setApplication(Application.create(config.APP));
  setup(QUnit.assert);
  QUnit.dump.maxDepth = 20;
  useTestWaiters(TestWaiters);

  // Must be false before realm modules are loaded — QUnit must not fire before
  // loader.import() has had a chance to register all QUnit.module()/test() calls.
  QUnit.config.autostart = false;

  loadRealmTests().catch(console.error);
}

async function loadRealmTests() {
  const helpers = await import('@cardstack/host/tests/helpers');
  const mockMatrix = await import('@cardstack/host/tests/helpers/mock-matrix');
  const testSetup = await import('@cardstack/host/tests/helpers/setup');
  const helperAdapter = await import('@cardstack/host/tests/helpers/adapter');

  let loader = getService('loader-service').loader;

  // Bridge the webpack-bundled test helpers into the Loader so realm-loaded
  // .gts files can import them by their module name at runtime.
  loader.shimModule('qunit', QUnit);
  loader.shimModule('@cardstack/host/tests/helpers', helpers);
  loader.shimModule('@cardstack/host/tests/helpers/mock-matrix', mockMatrix);
  loader.shimModule('@cardstack/host/tests/helpers/setup', testSetup);
  loader.shimModule('@cardstack/host/tests/helpers/adapter', helperAdapter);

  // Read realm URL from query string:
  //   /tests/live-test.html?realmURL=http://localhost:4201/experiments/
  const params = new URLSearchParams(window.location.search);
  const realmURL =
    params.get('realmURL') ?? 'http://localhost:4201/experiments/';
  const testModule = params.get('module') ?? 'sample-command-card';

  // loader.import fires QUnit.module()/test() as side effects
  await loader.import(`${realmURL}${testModule}`);

  QUnit.start();
}
