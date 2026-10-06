import EmberRouter from '@ember/routing/router';
import { setApplication } from '@ember/test-helpers';
import { setupEmberOnerrorValidation, start as qunitStart } from 'ember-qunit';
import EmberApp from 'ember-strict-application-resolver';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

class Router extends EmberRouter {
  location = 'none';
  rootURL = '/';
}

class TestApp extends EmberApp {
  modules = {
    './router': Router,
  };
}

Router.map(function () {});

export function start() {
  setApplication(
    TestApp.create({
      autoboot: false,
      rootElement: '#ember-testing',
    }),
  );

  setup(QUnit.assert);
  setupEmberOnerrorValidation();

  qunitStart();
}
