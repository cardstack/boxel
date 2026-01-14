import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';
import examStart from 'ember-exam/test-support/start';
import { useTestWaiters } from '@cardstack/runtime-common';
import * as TestWaiters from '@ember/test-waiters';

export function start(options) {
  QUnit.dump.maxDepth = 20;

  useTestWaiters(TestWaiters);
  setApplication(Application.create(config.APP));

  setup(QUnit.assert);
  setupOperatorModeParametersMatchAssertion(QUnit.assert);

  examStart(options);
}
