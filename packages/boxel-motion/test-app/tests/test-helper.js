import { setApplication } from '@ember/test-helpers';
import Application from 'boxel-motion-test-app/app';
import config from 'boxel-motion-test-app/config/environment';
import { start, setupEmberOnerrorValidation } from 'ember-qunit';
import { loadTests } from 'ember-qunit/test-loader';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

setApplication(Application.create(config.APP));

setup(QUnit.assert);
setupEmberOnerrorValidation();
loadTests();
start();
