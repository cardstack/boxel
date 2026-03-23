import { setApplication } from '@ember/test-helpers';

import * as TestWaiters from '@ember/test-waiters';

import { start } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { useTestWaiters } from '@cardstack/runtime-common';

import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';

const url = new URL(window.location.href);
const isLiveTest =
  url.pathname.endsWith('/live-test.html') || url.searchParams.has('liveTest');

if (!isLiveTest) {
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

  const qunitAny = /** @type {any} */ (QUnit);
  const originalQUnitStart =
    globalAny.__liveTestOriginalQUnitStart || QUnit.start;
  if (globalAny.__liveTestOriginalQUnitStart) {
    qunitAny.start = originalQUnitStart;
  }

  QUnit.dump.maxDepth = 20;

  useTestWaiters(TestWaiters);

  const urlParams = new URLSearchParams(window.location.search);

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

  const loadRealmTests = async () => {
    const qunitFilter = urlParams.get('filter');
    const qunitModule = urlParams.get('module');
    const testModuleParam = urlParams.get('testModule');

    if (qunitFilter) {
      QUnit.config.filter = qunitFilter;
    }
    if (qunitModule) {
      QUnit.config.module = qunitModule;
    }

    const realmURL =
      urlParams.get('realmURL') ?? 'http://localhost:4201/catalog/';

    const [helpers, mockMatrix, setupHelpers, adapter] = await Promise.all([
      import('@cardstack/host/tests/helpers'),
      import('@cardstack/host/tests/helpers/mock-matrix'),
      import('@cardstack/host/tests/helpers/setup'),
      import('@cardstack/host/tests/helpers/adapter'),
    ]);

    const loaderInstance = application.buildInstance({
      rootElement: '#ember-testing-loader',
    });
    await loaderInstance.boot();
    let loader = loaderInstance.lookup('service:loader-service').loader;

    loader.shimModule('qunit', QUnit);
    loader.shimModule('@cardstack/host/tests/helpers', helpers);
    loader.shimModule('@cardstack/host/tests/helpers/mock-matrix', mockMatrix);
    loader.shimModule('@cardstack/host/tests/helpers/setup', setupHelpers);
    loader.shimModule('@cardstack/host/tests/helpers/adapter', adapter);

    let testModuleNames;
    if (testModuleParam) {
      testModuleNames = testModuleParam
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
    } else {
      try {
        const resp = await fetch(realmURL, {
          headers: { Accept: 'application/vnd.api+json' },
        });
        const { data } = await resp.json();
        testModuleNames = Object.entries(data.relationships ?? {})
          .filter(
            ([name, entry]) =>
              name.endsWith('.gts') && entry.meta?.kind === 'file',
          )
          .map(([name]) => name.slice(0, -4));
      } catch {
        testModuleNames = [];
      }
    }

    const testModules = testModuleNames.map((name) => `${realmURL}${name}`);

    const capturedModules = new Set();
    const originalModule = QUnit.module;
    qunitAny.module = function (...args) {
      const [name] = args;
      if (typeof name === 'string') {
        capturedModules.add(name);
      }
      // @ts-expect-error QUnit.module has multiple call signatures
      return originalModule.apply(this, args);
    };

    try {
      for (const moduleURL of testModules) {
        let mod;
        try {
          mod = await loader.import(moduleURL);
        } catch {
          // skip files that fail to import (e.g. cards with unresolvable deps)
          continue;
        }
        if (typeof mod.runTests === 'function') {
          mod.runTests();
        }
      }
    } finally {
      qunitAny.module = originalModule;
      await loaderInstance.destroy();
    }

    if (capturedModules.size > 0) {
      QUnit.config.testFilter = (testInfo) =>
        capturedModules.has(testInfo.module);
    }

    if (!QUnit.config.started) {
      QUnit.start();
    }
  };

  loadRealmTests().catch((error) => {
    console.error('Failed to load realm tests', error);
    if (!QUnit.config.started) {
      QUnit.start();
    }
  });
}
