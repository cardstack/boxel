import * as QUnit from 'qunit';

/**
 * Discovers all *.test.gts module URLs in a realm using the _mtimes endpoint,
 * which returns a flat map of every file URL in the realm in one request.
 * Only modules that export a `runTests` function will actually register tests.
 *
 * @param {string} realmURL - The base realm URL (e.g. "http://localhost:4201/catalog/")
 * @returns {Promise<string[]>} Absolute module URLs (without the file extension)
 */
async function discoverTestModules(realmURL) {
  const resp = await fetch(`${realmURL}_mtimes`, {
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!resp.ok) {
    throw new Error(
      `Cannot access realm ${realmURL} (HTTP ${resp.status}). Check that the realm is publicly readable.`,
    );
  }
  const {
    data: {
      attributes: { mtimes },
    },
  } = await resp.json();

  return Object.keys(mtimes)
    .filter((url) => url.endsWith('.test.gts'))
    .map((url) => url.slice(0, -'.gts'.length));
}

// eslint-disable-next-line ember/no-test-import-export
export async function loadRealmTests(application) {
  const urlParams = new URLSearchParams(window.location.search);
  const qunitAny = /** @type {any} */ (QUnit);

  const qunitFilter = urlParams.get('filter');
  const qunitModule = urlParams.get('module');

  if (qunitFilter) {
    QUnit.config.filter = qunitFilter;
  }
  if (qunitModule) {
    QUnit.config.module = qunitModule;
  }

  const realmURL =
    urlParams.get('realmURL') ?? 'https://localhost:4201/skills/';

  const [
    helpers,
    mockMatrix,
    setupHelpers,
    adapter,
    renderComponent,
    baseRealm,
    universalEmberTestSupport,
    emberOwner,
    hostConfigEnvironment,
  ] = await Promise.all([
    import('@cardstack/host/tests/helpers'),
    import('@cardstack/host/tests/helpers/mock-matrix'),
    import('@cardstack/host/tests/helpers/setup'),
    import('@cardstack/host/tests/helpers/adapter'),
    import('@cardstack/host/tests/helpers/render-component'),
    import('@cardstack/host/tests/helpers/base-realm'),
    import('@universal-ember/test-support'),
    import('@ember/owner'),
    import('@cardstack/host/config/environment'),
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
  loader.shimModule(
    '@cardstack/host/tests/helpers/render-component',
    renderComponent,
  );
  loader.shimModule('@cardstack/host/tests/helpers/base-realm', baseRealm);
  loader.shimModule('@universal-ember/test-support', universalEmberTestSupport);
  loader.shimModule('@ember/owner', emberOwner);
  loader.shimModule('@cardstack/host/config/environment', {
    ...hostConfigEnvironment,
    default: {
      ...(hostConfigEnvironment.default ?? {}),
      resolvedCatalogRealmURL: realmURL,
    },
  });

  const testModules = await discoverTestModules(realmURL);

  // Under ESM, `QUnit` is a frozen namespace — we can't monkey-patch
  // `QUnit.module`. Instead, snapshot `QUnit.config.modules` before/after each
  // runTests() call and diff to identify newly registered module names.
  const capturedModules = new Set();
  const moduleList = () =>
    Array.isArray(qunitAny.config?.modules) ? qunitAny.config.modules : [];

  try {
    for (const moduleURL of testModules) {
      let mod;
      try {
        mod = await loader.import(moduleURL);
      } catch (err) {
        const message = err?.stack ?? err?.message ?? String(err);
        // Log to CI stdout so the failure is visible in the job log as well as
        // the junit report.
        console.error(`[live-test] Failed to import ${moduleURL}:\n${message}`);
        const failureModuleName = `Live Tests | Failed import: ${moduleURL}`;
        QUnit.module(failureModuleName, function () {
          QUnit.test('module failed to import', function (assert) {
            assert.ok(false, `Failed to import ${moduleURL}: ${message}`);
          });
        });
        capturedModules.add(failureModuleName);
        continue;
      }
      if (typeof mod.runTests === 'function') {
        const before = new Set(moduleList().map((m) => m.name));
        mod.runTests();
        for (const m of moduleList()) {
          if (!before.has(m.name)) {
            capturedModules.add(m.name);
          }
        }
      }
    }
  } finally {
    await loaderInstance.destroy();
  }

  if (capturedModules.size === 0) {
    console.warn(
      `[live-test] No realm test modules found. Searched ${testModules.length} module(s) in ${realmURL}`,
    );
    QUnit.module('Live Tests', function () {
      QUnit.test('no realm tests found', function (assert) {
        assert.ok(true, 'No realm test modules discovered');
      });
    });
  } else {
    console.log(`[live-test] Found ${capturedModules.size} test module(s):`, [
      ...capturedModules,
    ]);
  }

  QUnit.config.testFilter = (testInfo) => capturedModules.has(testInfo.module);

  if (!QUnit.config.started) {
    QUnit.start();
  }
}
