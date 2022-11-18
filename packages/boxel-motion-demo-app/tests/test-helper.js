import { setApplication } from '@ember/test-helpers';
import Application from 'boxel-motion-demo-app/app';
import config from 'boxel-motion-demo-app/config/environment';
import { start } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

setApplication(Application.create(config.APP));

setup(QUnit.assert);

start();
