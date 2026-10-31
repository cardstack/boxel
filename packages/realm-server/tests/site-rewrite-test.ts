import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { JSDOM } from 'jsdom';
import { linkedCards, siteRewriter } from '../lib/site-rewrite.ts';

const STORE = 'https://realms.example/owner/store/';
const PATHS = new Map([
  [`${STORE}Product/driver`, '/shop/driver'],
  [`${STORE}Brand/cordell`, '/brands/cordell'],
]);

function rewriter() {
  return siteRewriter({
    requestMount: new URL('https://view.example/sites/owner/shop/'),
    requestPath: '/shop/driver',
    paths: PATHS,
    document: new JSDOM().window.document,
  });
}

function hrefs(html: string): string[] {
  let template = new JSDOM().window.document.createElement('template');
  template.innerHTML = html;
  return [...template.content.querySelectorAll('a')].map(
    (a) => a.getAttribute('href')!,
  );
}

module(basename(import.meta.filename), function () {
  test('a link to a routed card points at its path on the request host', function (assert) {
    let html = rewriter().body(
      '<a href="../Brand/cordell">Maker</a><a href="./driver.json#specs">Specs</a>',
      new URL(`${STORE}Product/driver`),
    );
    assert.deepEqual(hrefs(html), [
      'https://view.example/sites/owner/shop/brands/cordell',
      'https://view.example/sites/owner/shop/shop/driver#specs',
    ]);
  });

  test('other links, and links within the page, stay as written', function (assert) {
    let html = rewriter().body(
      '<a href="https://elsewhere.example/">Out</a><a href="#top">Top</a><a href="../Category/clubs">Clubs</a>',
      new URL(`${STORE}Product/driver`),
    );
    assert.deepEqual(hrefs(html), [
      'https://elsewhere.example/',
      '#top',
      '../Category/clubs',
    ]);
  });

  test('the canonical link and og:url name the page on the request host, once each', function (assert) {
    let head = rewriter().head(
      `<title>Driver</title><link rel="canonical" href="${STORE}Product/driver"><meta property="og:url" content="${STORE}Product/driver"><meta property="og:title" content="Driver">`,
    );
    let template = new JSDOM().window.document.createElement('template');
    template.innerHTML = head;
    let canonicals = template.content.querySelectorAll('link[rel="canonical"]');
    let ogURLs = template.content.querySelectorAll('meta[property="og:url"]');
    let address = 'https://view.example/sites/owner/shop/shop/driver';
    assert.strictEqual(canonicals.length, 1, 'one canonical link');
    assert.strictEqual(canonicals[0].getAttribute('href'), address);
    assert.strictEqual(ogURLs.length, 1, 'one og:url');
    assert.strictEqual(ogURLs[0].getAttribute('content'), address);
    assert.ok(
      template.content.querySelector('meta[property="og:title"]'),
      'other head tags stay',
    );
  });

  test('linkedCards lists each http(s) link target once, as a card key', function (assert) {
    let cards = linkedCards(
      '<a href="../Brand/cordell">A</a><a href="../Brand/cordell.json#x">B</a><a href="#top">C</a><a href="mailto:x@example.com">D</a>',
      new URL(`${STORE}Product/driver`),
      new JSDOM().window.document,
    );
    assert.deepEqual(cards, [`${STORE}Brand/cordell`]);
  });
});
