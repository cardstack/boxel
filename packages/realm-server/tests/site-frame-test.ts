import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { JSDOM } from 'jsdom';
import { framePage } from '../lib/site-frame.ts';

function compose(frame: string, page: string) {
  return framePage(frame, page, new JSDOM().window.document);
}

module(basename(import.meta.filename), function () {
  test('the page goes where the frame placed <SitePage />', function (assert) {
    let html = compose(
      '<header>Shop</header><div data-boxel-site-page class="page"></div><footer>Fine print</footer>',
      '<h1>Saltmarsh Milled Putter</h1>',
    );
    assert.strictEqual(
      html,
      '<header>Shop</header><div data-boxel-site-page="" class="page"><h1>Saltmarsh Milled Putter</h1></div><footer>Fine print</footer>',
    );
  });

  test('a frame without an outlet is shown above the page', function (assert) {
    assert.strictEqual(
      compose('<header>Shop</header>', '<h1>Page</h1>'),
      '<header>Shop</header><h1>Page</h1>',
    );
  });
});
