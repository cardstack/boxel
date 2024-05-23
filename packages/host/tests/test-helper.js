import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { start } from 'ember-qunit';
import { getTimes } from '@cardstack/runtime-common/helpers/time';

import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';

QUnit.on('runEnd', () => {
  console.log('Done all tests');

  let times = getTimes();

  [...times.keys()].forEach((key) => {
    console.log(`${key}: ${times.get(key)}`);
  });
});

setApplication(Application.create(config.APP));

setup(QUnit.assert);
setupOperatorModeParametersMatchAssertion(QUnit.assert);

start();
