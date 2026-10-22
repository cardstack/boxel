import Application from '@ember/application';
import { setApplication } from '@ember/test-helpers';
import { start as qunitStart, setupEmberOnerrorValidation } from 'ember-qunit';
import * as QUnit from 'qunit';
import { setup } from 'qunit-dom';

// The pages mount their components with `renderComponent` and have no
// application. Rendering tests need an owner, so the suite boots an empty one,
// whose resolver finds nothing: every component a test renders is imported.
class TestApplication extends Application {
  modulePrefix = 'secure-origin-tests';
  Resolver = {
    create: () => ({ resolve: () => undefined }),
  } as unknown as Application['Resolver'];
}

export function start() {
  setApplication(
    TestApplication.create({ autoboot: false, rootElement: '#ember-testing' }),
  );
  setup(QUnit.assert);
  setupEmberOnerrorValidation();
  qunitStart();
}
