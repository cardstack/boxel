// The theme tests assert against the design tokens these sheets define,
// matching what consuming apps load globally.
import '../src/styles/global.css';
import '../src/styles/variables.css';
import '../src/styles/theme.css';

import EmberRouter from '@ember/routing/router';
import { setApplication } from '@ember/test-helpers';
import {
  setRunOptions,
  setupConsoleLogger,
} from 'ember-a11y-testing/test-support';
import { setConfig as setBasicDropdownConfig } from 'ember-basic-dropdown/config';
import { setupEmberOnerrorValidation, start as qunitStart } from 'ember-qunit';
import EmberApp from 'ember-strict-application-resolver';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import setupHeightAssertion from './helpers/height-assertion';

class Router extends EmberRouter {
  location = 'none';
  rootURL = '/';
}

// Some dependencies (e.g. ember-basic-dropdown) look up config:environment
// at runtime; the strict resolver serves it from this module entry.
const config = {
  environment: 'test',
  modulePrefix: 'boxel-ui-tests',
  rootURL: '/',
  locationType: 'none',
  APP: {
    rootElement: '#ember-testing',
    autoboot: false,
  },
};

class TestApp extends EmberApp {
  modules = {
    './router': Router,
    './config/environment': { default: config },
  };
}

Router.map(function () {});

export function start() {
  // ember-basic-dropdown 9 has no boot-time initializer; without this its
  // content teleports to a destination element that doesn't exist and
  // silently renders nothing. Point it inside the test root so scoped DOM
  // helpers can see dropdown content.
  setBasicDropdownConfig({ destination: 'ember-testing' });

  setApplication(
    TestApp.create({
      autoboot: false,
      rootElement: '#ember-testing',
    }),
  );

  setup(QUnit.assert);
  setupHeightAssertion(QUnit.assert);

  // https://github.com/dequelabs/axe-core/issues/3082
  // turn off the rule for aria-allowed-role for now until ember-a11y-testing
  // is updated with bugfix from axe-core
  setRunOptions({
    rules: {
      'aria-allowed-role': { enabled: false },
    },
  });
  setupConsoleLogger();
  setupEmberOnerrorValidation();
  qunitStart();
}
