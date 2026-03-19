import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { useTestWaiters } from '@cardstack/runtime-common';
import * as TestWaiters from '@ember/test-waiters';
import { start } from 'ember-qunit';

const isLiveTest = new URL(window.location.href).pathname.endsWith(
  '/live-test.html',
);

if (!isLiveTest) {
  // eslint-disable-next-line no-console
  console.warn('[live-test] Skipping initialization outside live-test.html');
} else {
  const globalAny = /** @type {any} */ (globalThis);
  globalAny.__liveTestLoaded = true;

  const statusEl = document.getElementById('live-test-status');
  if (statusEl) {
    statusEl.textContent = 'Live-test runner loaded.';
  }

  if (globalAny.QUnit !== QUnit) {
    globalThis.QUnit = QUnit;
  }

  const originalQUnitStart =
    globalAny.__liveTestOriginalQUnitStart || QUnit.start;
  if (globalAny.__liveTestOriginalQUnitStart) {
    QUnit.start = originalQUnitStart;
  }

  QUnit.dump.maxDepth = 20;

  useTestWaiters(TestWaiters);

  const application = Application.create({
    ...config.APP,
    rootElement: '#ember-testing',
  });
  setApplication(application);

  setup(QUnit.assert);

  QUnit.config.autostart = false;
  start({ loadTests: false, startTests: false });

  document.getElementById('live-test-start')?.addEventListener('click', () => {
    if (!QUnit.config.started) {
      QUnit.start();
    }
  });

  async function loadRealmTests() {
    const urlParams = new URLSearchParams(window.location.search);
    const qunitFilter = urlParams.get('filter');
    const qunitModule = urlParams.get('module');
    const testModuleParam = urlParams.get('testModule');

    if (qunitFilter) {
      QUnit.config.filter = qunitFilter;
    }
    if (qunitModule) {
      QUnit.config.module = qunitModule;
    }

    const helpers = await import('@cardstack/host/tests/helpers');
    const mockMatrix = await import(
      '@cardstack/host/tests/helpers/mock-matrix'
    );
    const setupHelpers = await import('@cardstack/host/tests/helpers/setup');

    const loaderInstance = application.buildInstance({
      rootElement: '#ember-testing-loader',
    });
    await loaderInstance.boot();
    let loader = loaderInstance.lookup('service:loader-service').loader;

    loader.shimModule('qunit', QUnit);
    loader.shimModule('@cardstack/host/tests/helpers', helpers);
    loader.shimModule('@cardstack/host/tests/helpers/mock-matrix', mockMatrix);
    loader.shimModule('@cardstack/host/tests/helpers/setup', setupHelpers);

    const realmURL =
      urlParams.get('realmURL') ?? 'http://localhost:4201/experiments/';

    const testModules = (testModuleParam ?? 'sample-command-card')
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((name) => `${realmURL}${name}`);

    const capturedModules = new Set();
    const originalModule = QUnit.module;
    QUnit.module = function (...args) {
      const [name] = args;
      if (typeof name === 'string') {
        capturedModules.add(name);
      }
      // @ts-expect-error QUnit.module has multiple call signatures
      return originalModule.apply(this, args);
    };

    try {
      for (const moduleURL of testModules) {
        const mod = await loader.import(moduleURL);
        if (typeof mod.runTests === 'function') {
          mod.runTests();
        }
      }
    } finally {
      QUnit.module = originalModule;
      await loaderInstance.destroy();
    }

    if (capturedModules.size > 0) {
      QUnit.config.testFilter = (testInfo) =>
        capturedModules.has(testInfo.module);
    }

    if (!QUnit.config.started) {
      QUnit.start();
    }
  }

  loadRealmTests().catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to load realm tests', error);
    if (!QUnit.config.started) {
      QUnit.start();
    }
  });
}
