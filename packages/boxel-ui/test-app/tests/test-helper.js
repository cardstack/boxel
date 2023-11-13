import Application from 'test-app/app';
import config from 'test-app/config/environment';
import * as QUnit from 'qunit';
import { setApplication } from '@ember/test-helpers';
import { setup } from 'qunit-dom';
import { start } from 'ember-qunit';
import {
  setRunOptions,
  setupConsoleLogger,
} from 'ember-a11y-testing/test-support';
import setupHeightAssertion from 'test-app/tests/helpers/height-assertion';

setApplication(Application.create(config.APP));

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

start();
