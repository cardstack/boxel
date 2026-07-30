import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';
import { start as examStart } from 'ember-exam/test-support';
// eslint-disable-next-line ember/no-test-import-export
import { loadRealmTests } from './live-test';
import { setupQUnit } from './helpers/setup-qunit';
import { registerShardWarmup } from './helpers/shard-warmup';
import { selectShardModules } from './helpers/shard-modules';
import testModuleTimings from './test-module-timings.json';

export async function start(examOptions) {
  const application = Application.create({
    ...config.APP,
    rootElement: '#ember-testing',
  });

  async function setupHostTests() {
    setApplication(application);
    setupQUnit();
    setupOperatorModeParametersMatchAssertion(QUnit.assert);

    const urlParams = new URLSearchParams(window.location.search);
    const isParallelRun =
      urlParams.has('shard') ||
      urlParams.has('browser') ||
      urlParams.has('partition');

    if (isParallelRun) {
      QUnit.config.failOnZeroTests = false;
      registerShardWarmup();
    }

    let options = examOptions;
    if (urlParams.has('shard')) {
      // CI shards the suite by duration-weighted bin-packing of test files
      // (see helpers/shard-modules.ts): keep only this shard's subset of
      // the test-module map so the other shards' files are never loaded.
      const shard = Number(urlParams.get('shard'));
      const shardCount = Number(urlParams.get('shardCount'));
      const { availableModules } = examOptions;
      const selected = selectShardModules(
        Object.keys(availableModules),
        shard,
        shardCount,
        testModuleTimings,
      );
      options = {
        ...examOptions,
        availableModules: Object.fromEntries(
          selected.map((id) => [id, availableModules[id]]),
        ),
      };
    }

    await examStart(options);
  }

  function setupLiveTests() {
    setApplication(application);
    setupQUnit();

    loadRealmTests(application).catch((error) => {
      const details =
        error?.stack ||
        error?.message ||
        JSON.stringify(error) ||
        String(error);
      console.error(`Failed to load realm tests: ${details}`);
      QUnit.start(); //restarting test due to failure
    });
  }

  // Single check — prevents double QUnit initialization (one QUnit instance only).
  const isLiveTest = new URL(window.location.href).searchParams.has('liveTest');

  if (isLiveTest) {
    setupLiveTests();
  } else {
    await setupHostTests();
  }
}
