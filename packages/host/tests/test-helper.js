import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';
import start from 'ember-exam/test-support/start';
import { useTestWaiters } from '@cardstack/runtime-common';
import * as TestWaiters from '@ember/test-waiters';
// eslint-disable-next-line ember/no-test-import-export
import './live-test';

const url = new URL(window.location.href);
const isLiveTest =
  url.pathname.endsWith('/live-test.html') || url.searchParams.has('liveTest');

if (!isLiveTest) {
  QUnit.dump.maxDepth = 20;

  useTestWaiters(TestWaiters);
  setApplication(Application.create(config.APP));

  setup(QUnit.assert);
  setupOperatorModeParametersMatchAssertion(QUnit.assert);

  const urlParams = new URLSearchParams(window.location.search);
  const isParallelExamRun =
    urlParams.has('browser') || urlParams.has('partition');

  if (isParallelExamRun) {
    QUnit.config.failOnZeroTests = false;
  }

  start();
}
