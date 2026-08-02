import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

module('Unit | Service | realm sandbox styles', function (hooks) {
  setupTest(hooks);

  test('shares identical scoped styles until the last card releases them', function (assert) {
    let service = getService('realm-sandbox-styles');
    let css = '[data-scope="example"] { color: rebeccapurple; }';

    let releaseFirst = service.acquire([css, css]);
    let releaseSecond = service.acquire([css]);
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      1,
      'one document stylesheet serves every matching card',
    );

    releaseFirst();
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      1,
      'the stylesheet remains while another card consumes it',
    );

    releaseSecond();
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      0,
      'the last release removes the stylesheet',
    );
  });
});
