import EmberRouter from '@ember/routing/router';
import { setApplication } from '@ember/test-helpers';
import { setTesting } from '@embroider/macros';
import {
  setRunOptions,
  setupConsoleLogger,
} from 'ember-a11y-testing/test-support';
import { setupEmberOnerrorValidation, start as qunitStart } from 'ember-qunit';
import EmberApp from 'ember-strict-application-resolver';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import setupHeightAssertion from './helpers/height-assertion';

class Router extends EmberRouter {
  location = 'none';
  rootURL = '/';
}

class TestApp extends EmberApp {
  modules = {
    './router': Router,
    // add any custom services here
    // import.meta.glob('./services/*', { eager: true }),
  };
}

Router.map(function () {});

export function start() {
  setTesting(true);
  setApplication(
    TestApp.create({
      autoboot: false,
      rootElement: '#ember-testing',
    }),
  );
  setup(QUnit.assert);
  setupHeightAssertion(QUnit.assert);
  // https://github.com/dequelabs/axe-core/issues/3082
  // turn off the rule for aria-allowed-role for now until ember-a11y-testing is updated with bugfix from axe-core
  setRunOptions({
    rules: {
      'aria-allowed-role': { enabled: false },
    },
  });
  setupConsoleLogger();
  setupEmberOnerrorValidation();
  qunitStart();
}
