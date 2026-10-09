import { setApplication } from '@ember/test-helpers';
import Application from 'choreo-film-app/app';
import config from 'choreo-film-app/config/environment';
import { setupEmberOnerrorValidation, start as qunitStart } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

export function start() {
  setApplication(Application.create(config.APP));

  setup(QUnit.assert);
  setupEmberOnerrorValidation();

  qunitStart();
}
