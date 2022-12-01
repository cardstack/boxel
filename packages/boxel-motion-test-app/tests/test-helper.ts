import { setApplication } from '@ember/test-helpers';
import Application from 'boxel-motion-test-app/app';
import config from 'boxel-motion-test-app/config/environment';
import { start } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';
import { setup as setupMeasurements } from './helpers/assert-measurements';

setApplication(Application.create(config.APP));

setup(QUnit.assert);
setupMeasurements(QUnit.assert);

start();
