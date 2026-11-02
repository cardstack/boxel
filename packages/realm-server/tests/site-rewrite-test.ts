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

  test('a link marked with a site path points at that path under the site', function (assert) {
    let html = rewriter().body(
      '<a href="#/shop" data-boxel-card-link="/shop">Shop</a><a href="#/journal" data-boxel-card-link="/journal#latest">Journal</a><a href="x" data-boxel-card-link="//elsewhere.example/">Out</a>',
      new URL(`${STORE}Storefront/main`),
    );
    assert.deepEqual(hrefs(html), [
      'https://view.example/sites/owner/shop/shop',
      'https://view.example/sites/owner/shop/journal#latest',
      'x',
    ]);
  });

  test('a page that answers 404 carries no canonical link or og:url', function (assert) {
    let head = siteRewriter({
      requestMount: new URL('https://view.example/sites/owner/shop/'),
      requestPath: '/no-such-page',
      paths: PATHS,
      canonical: false,
      document: new JSDOM().window.document,
    }).head(
      `<title>Not found</title><link rel="canonical" href="${STORE}NotFoundPage/main">`,
    );
    assert.false(head.includes('rel="canonical"'), head);
    assert.false(head.includes('og:url'), head);
    assert.true(head.includes('<title>Not found</title>'), head);
  });

  test('linkedCards lists each http(s) link target once, as a card key', function (assert) {
    let cards = linkedCards(
      '<a href="../Brand/cordell">A</a><a href="../Brand/cordell.json#x">B</a><a href="#top">C</a><a href="mailto:x@example.com">D</a>',
      new URL(`${STORE}Product/driver`),
      new JSDOM().window.document,
    );
    assert.deepEqual(cards, [`${STORE}Brand/cordell`]);
  });

  test('a share title becomes the page title too', function (assert) {
    let head = siteRewriter({
      requestMount: new URL('https://view.example/sites/owner/shop/'),
      canonicalMount: new URL('https://view.example/sites/owner/shop/'),
      requestPath: '/tags/drivers',
      paths: new Map(),
      share: { title: '#drivers on Shop' },
      document: new JSDOM().window.document,
    }).head('<title>Shop</title>');
    let template = new JSDOM().window.document.createElement('template');
    template.innerHTML = head;
    let titles = template.content.querySelectorAll('title');
    assert.strictEqual(titles.length, 1, 'one title');
    assert.strictEqual(titles[0].textContent, '#drivers on Shop');
  });
});
