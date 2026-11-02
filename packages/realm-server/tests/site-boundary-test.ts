import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  realmAlias,
  SiteTranslator,
  type SiteBoundary,
} from '../lib/site-boundary.ts';

const SECRET = 'a-test-secret';
const SITE = 'https://view.example/sites/owner/shop/';
const STORE = 'https://realms.example/owner/store/';
const ALIASED = `${SITE}_r/${realmAlias(SECRET, SITE, STORE)}/`;

function translator() {
  let boundary: SiteBoundary = {
    site: SITE,
    realms: [{ canonical: STORE, aliased: ALIASED }],
    info: {
      name: 'The Shop',
      iconURL: 'https://img.example/shop.png',
      backgroundURL: null,
    },
  };
  return new SiteTranslator([boundary]);
}

module(basename(import.meta.filename), function () {
  test('an alias is 26 base32 characters, the same on every server', function (assert) {
    let alias = realmAlias(SECRET, SITE, STORE);
    assert.true(/^[a-z2-7]{26}$/.test(alias), alias);
    assert.strictEqual(realmAlias(SECRET, SITE, STORE), alias);
  });

  test('a realm has a different alias on every site, and under every secret', function (assert) {
    let alias = realmAlias(SECRET, SITE, STORE);
    assert.notStrictEqual(
      realmAlias(SECRET, 'https://view.example/sites/owner/other/', STORE),
      alias,
      'so two sites cannot be linked through a realm they share',
    );
    assert.notStrictEqual(realmAlias('another-secret', SITE, STORE), alias);
  });

  test('outbound, a source realm’s URL becomes its alias, spelled out or URL-encoded', function (assert) {
    let t = translator();
    assert.strictEqual(
      t.outbound(`<a href="${STORE}Product/driver">`),
      `<a href="${ALIASED}Product/driver">`,
    );
    assert.strictEqual(
      t.outbound(`content="${encodeURIComponent(`${STORE}Frame/main`)}"`),
      `content="${encodeURIComponent(`${ALIASED}Frame/main`)}"`,
    );
    assert.strictEqual(
      t.outbound(`${SITE}About/us`),
      `${SITE}About/us`,
      'the site’s own URLs are its address, and stay',
    );
  });

  test('inbound, an alias becomes the realm’s URL again', function (assert) {
    let t = translator();
    let body = JSON.stringify({
      realms: [ALIASED],
      filter: { type: { module: `${ALIASED}product`, name: 'Product' } },
    });
    assert.deepEqual(JSON.parse(t.inbound(body)), {
      realms: [STORE],
      filter: { type: { module: `${STORE}product`, name: 'Product' } },
    });
    assert.strictEqual(t.outbound(t.inbound(body)), body);
  });

  test('an aliased realm describes itself as the site does', function (assert) {
    let t = translator();
    let doc = {
      data: {
        id: `${STORE}Product/driver`,
        meta: {
          realmURL: STORE,
          realmInfo: {
            name: 'Owner’s private store',
            iconURL: 'https://img.example/owner.png',
            backgroundURL: 'https://img.example/bg.png',
            realmUserId: '@owner_realm:matrix.example',
            lastPublishedAt: { [`${STORE}`]: '1' },
            publishable: true,
            visibility: 'public',
          },
        },
      },
    };
    let out = JSON.parse(t.outboundJSON(JSON.stringify(doc)));
    assert.strictEqual(out.data.id, `${ALIASED}Product/driver`);
    assert.deepEqual(out.data.meta.realmInfo, {
      name: 'The Shop',
      iconURL: 'https://img.example/shop.png',
      backgroundURL: null,
      lastPublishedAt: null,
      publishable: null,
      visibility: 'public',
    });

    let info = JSON.parse(
      t.outboundJSON(
        JSON.stringify({
          data: {
            type: 'realm-info',
            id: STORE,
            attributes: { name: 'Owner’s private store', realmUserId: 'x' },
          },
        }),
      ),
    );
    assert.strictEqual(info.data.attributes.name, 'The Shop');
    assert.false('realmUserId' in info.data.attributes);
  });

  test('a page’s inlined card data is translated as card data is', function (assert) {
    let t = translator();
    let doc = JSON.stringify({
      data: {
        id: `${STORE}Product/driver`,
        attributes: { note: '<b>bold</b>' },
        meta: { realmURL: STORE, realmInfo: { name: 'Private' } },
      },
    }).replace(/</g, '\\u003c');
    let html = `<head><script type="application/json" data-boxel-page-doc data-card-url="${STORE}Product/driver">${doc}</script></head>`;
    let out = t.outboundHTML(html);
    assert.false(out.includes(STORE), 'nothing names the source realm');
    assert.false(out.includes('<b>'), 'the data stays escaped for a script');
    let inlined = JSON.parse(
      out
        .match(/data-boxel-page-doc[^>]*>([\s\S]*?)<\/script>/)![1]
        .replace(/\\u003c/g, '<'),
    );
    assert.strictEqual(inlined.data.meta.realmInfo.name, 'The Shop');
    assert.strictEqual(inlined.data.attributes.note, '<b>bold</b>');
  });
});
