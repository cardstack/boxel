import { setApplication } from '@ember/test-helpers';
import { setTesting } from '@embroider/macros';
import {
  setRunOptions,
  setupConsoleLogger,
} from 'ember-a11y-testing/test-support';
import { setupEmberOnerrorValidation, start as qunitStart } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

import { App } from '../demo-app/app.gts';
import setupHeightAssertion from './helpers/height-assertion';

export function start() {
  setTesting(true);
  setApplication(
    App.create({
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
