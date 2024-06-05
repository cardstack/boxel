import Application from '@cardstack/host/app';
import config from '@cardstack/host/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { logger } from '@cardstack/runtime-common';
import { setup } from 'qunit-dom';
import { getTimes } from '@cardstack/runtime-common/helpers/time';

import setupOperatorModeParametersMatchAssertion from '@cardstack/host/tests/helpers/operator-mode-parameters-match';
import start from 'ember-exam/test-support/start';

const log = logger('current-run');

console.log('Setting Qunit hooks?');

log.error('Setting Qunit hooks?');

QUnit.on('runStart', () => {
  log.error('Starting tests abcdefghijklmnopqrstuvwxyz');
});

QUnit.on('suiteEnd', (suiteEnd) => {
  console.log(`Done tests for ${suiteEnd.name}`);

  let times = getTimes();

  [...times.keys()].forEach((key) => {
    log.error(`${key}: ${times.get(key)}`);
  });
  log.error(JSON.stringify(Array.from(times.entries())));

  log.error('that is all');
});

QUnit.on('runEnd', () => {
  console.log('Done all tests');

  let times = getTimes();

  [...times.keys()].forEach((key) => {
    log.error(`${key}: ${times.get(key)}`);
  });
  log.error(JSON.stringify(Array.from(times.entries())));

  log.error('that is all');
});

QUnit.done(async () => {
  console.log('Done all tests?? again');

  let times = getTimes();

  [...times.keys()].forEach((key) => {
    log.error(`${key}: ${times.get(key)}`);
  });

  log.error('that is all…?');

  return new Promise((resolve) => {
    log.error('waiting for logs to flush');
    setTimeout(() => {
      log.error('logs flushed?');
      resolve();
    }, 5000);
  });
});

setApplication(Application.create(config.APP));

setup(QUnit.assert);
setupOperatorModeParametersMatchAssertion(QUnit.assert);

start();
