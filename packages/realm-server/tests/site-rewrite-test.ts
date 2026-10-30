import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { JSDOM } from 'jsdom';
import type { HostRouteRow } from '@cardstack/runtime-common';
import { siteRewriter } from '../lib/site-rewrite.ts';

const STORE = 'https://realms.example/owner/store/';
const ROWS: HostRouteRow[] = [
  {
    path: '/shop/driver',
    kind: 'page',
    cardURL: `${STORE}Product/driver`,
    claimedAt: 1,
  },
  {
    path: '/p/sku-1',
    kind: 'alias',
    cardURL: `${STORE}Product/driver`,
    targetPath: '/shop/driver',
    claimedAt: 1,
  },
  {
    path: '/brands/cordell',
    kind: 'page',
    cardURL: `${STORE}Brand/cordell`,
    claimedAt: 1,
  },
];

function rewriter(canonical?: string) {
  return siteRewriter({
    requestMount: new URL('https://view.example/sites/owner/shop/'),
    canonicalMount: canonical ? new URL(canonical) : undefined,
    requestPath: '/shop/driver',
    rows: ROWS,
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

  test('the canonical link and og:url name the page on the canonical host URL', function (assert) {
    let head = rewriter('https://shop.example/').head(
      `<title>Driver</title><link rel="canonical" href="${STORE}Product/driver"><meta property="og:url" content="${STORE}Product/driver"><meta property="og:title" content="Driver">`,
    );
    let template = new JSDOM().window.document.createElement('template');
    template.innerHTML = head;
    let canonicals = template.content.querySelectorAll('link[rel="canonical"]');
    let ogURLs = template.content.querySelectorAll('meta[property="og:url"]');
    assert.strictEqual(canonicals.length, 1, 'one canonical link');
    assert.strictEqual(
      canonicals[0].getAttribute('href'),
      'https://shop.example/shop/driver',
    );
    assert.strictEqual(ogURLs.length, 1, 'one og:url');
    assert.strictEqual(
      ogURLs[0].getAttribute('content'),
      'https://shop.example/shop/driver',
    );
    assert.ok(
      template.content.querySelector('meta[property="og:title"]'),
      'other head tags stay',
    );
  });

  test('with no host URL listed, the canonical is on the request host', function (assert) {
    let head = rewriter().head('<title>Driver</title>');
    assert.true(
      head.includes('href="https://view.example/sites/owner/shop/shop/driver"'),
      head,
    );
  });
});
