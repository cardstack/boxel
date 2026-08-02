import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { validateCompartmentCSS } from '@cardstack/host/services/realm-sandbox';

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

  test('uses parsed CSS to reject network-bearing values', function (assert) {
    let safe = '[data-scope="example"] { color: rebeccapurple; }';
    assert.strictEqual(validateCompartmentCSS(safe), safe);

    for (let css of [
      '@import "https://evil.example/steal.css";',
      '.card { background: url("https://evil.example/steal"); }',
      '.card { background-image: image-set("https://evil.example/steal" 1x); }',
      '.card { background-image: -webkit-image-set("steal.png" 1x); }',
      '.card { background: u\\72l("https://evil.example/steal"); }',
      '@\\69 mport "https://evil.example/steal.css";',
      '.card { background: \\75 rl("https://evil.example/steal"); }',
      '.card { background-image: image\\2d set("steal.png" 1x); }',
    ]) {
      assert.throws(
        () => validateCompartmentCSS(css),
        /network-bearing value/,
        css,
      );
    }
  });
});
