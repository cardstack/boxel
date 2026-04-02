import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';
import examStart from 'ember-exam/test-support/start';
// eslint-disable-next-line ember/no-test-import-export
import { loadRealmTests } from './live-test';
import { setupQUnit } from './helpers/setup-qunit';

export function start() {
  const application = Application.create({
    ...config.APP,
    rootElement: '#ember-testing',
  });

  function setupHostTests() {
    setApplication(application);
    setupQUnit();
    setupOperatorModeParametersMatchAssertion(QUnit.assert);

    const urlParams = new URLSearchParams(window.location.search);
    const isParallelExamRun =
      urlParams.has('browser') || urlParams.has('partition');

    if (isParallelExamRun) {
      QUnit.config.failOnZeroTests = false;
    }

    examStart();
  }

  function setupLiveTests() {
    setApplication(application);
    setupQUnit();

    loadRealmTests(application).catch((error) => {
      console.error('Failed to load realm tests', error);
      QUnit.start(); //restarting test due to failure
    });
  }

  // Single check — prevents double QUnit initialization (one QUnit instance only).
  const isLiveTest = new URL(window.location.href).searchParams.has('liveTest');

  if (isLiveTest) {
    setupLiveTests();
  } else {
    setupHostTests();
  }
}
