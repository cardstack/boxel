import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const configMetaRE =
  /<meta\s+name="@cardstack\/host\/config\/environment"\s+content="([^"]*)"\s*\/?>/;

async function configFrom(documentPath) {
  let html = await readFile(documentPath, 'utf8');
  let match = html.match(configMetaRE);
  assert.ok(
    match,
    `${documentPath} is missing the Host environment configuration meta tag`,
  );
  return JSON.parse(decodeURIComponent(match[1]));
}

let applicationConfig = await configFrom('dist/index.html');
let testConfig = await configFrom('dist/tests/index.html');

assert.notEqual(
  applicationConfig.environment,
  'test',
  'dist/index.html must use the application environment configuration',
);
assert.equal(
  testConfig.environment,
  'test',
  'dist/tests/index.html must use the test environment configuration',
);
assert.equal(testConfig.locationType, 'none');
assert.equal(testConfig.APP?.rootElement, '#ember-testing');
assert.equal(testConfig.APP?.autoboot, false);
assert.equal(testConfig.autoSaveDelayMs, 0);
assert.equal(testConfig.monacoDebounceMs, 0);
assert.equal(testConfig.serverEchoDebounceMs, 0);
assert.equal(testConfig.realmServerURL, 'http://test-realm');
assert.equal(
  typeof testConfig.sqlSchema,
  'string',
  'the test configuration must include the SQLite schema',
);

if (process.env.BOXEL_ENVIRONMENT === 'ci') {
  for (let config of [applicationConfig, testConfig]) {
    assert.equal(config.matrixURL, 'https://matrix.ci.localhost');
    assert.equal(
      config.resolvedBaseRealmURL,
      'https://realm-server.ci.localhost/base/',
    );
    assert.equal(config.iconsURL, 'https://icons.ci.localhost');
    assert.equal(config.boxelSandboxRuntimeURL, 'https://sandbox.ci.localhost');
  }
}

console.log('Verified application and test document environment configs');
