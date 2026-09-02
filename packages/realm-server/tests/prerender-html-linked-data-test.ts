import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import { setupPermissionedRealmCached } from './helpers/index.ts';
import {
  maxPrerenderHtmlJobId,
  prerenderedHtmlRowFor,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// A consumer whose isolated template renders a linked card. The persisted
// prerendered_html row is the contract these tests pin: the linked card's
// data must appear in the consumer's HTML, both on the first render and on
// the re-render its invalidation fans out after the linked card is edited.
// Assertions quote the HTML on failure so a red run carries the evidence.
function makeFileSystem() {
  return {
    'cards.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Vendor extends CardDef {
        @field name = contains(StringField);
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <span>Supplied by <@fields.name/></span>
          </template>
        }
      }

      export class Listing extends CardDef {
        @field name = contains(StringField);
        @field vendor = linksTo(Vendor);
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1>Listing: <@fields.name/></h1>
            <@fields.vendor/>
          </template>
        }
      }
    `,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup({ dbAdapter, testRealm: r }) {
      testDbAdapter = dbAdapter;
      realm = r;
    },
  });

  async function writeAndSettle(path: string, doc: string) {
    let baseline = await maxPrerenderHtmlJobId(testDbAdapter, realm.url);
    await realm.write(path, doc);
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url, {
      afterJobId: baseline,
      timeout: 60000,
    });
  }

  function vendorDoc(name: string) {
    return JSON.stringify({
      data: {
        attributes: { name },
        meta: {
          adoptsFrom: { module: rri('./cards'), name: 'Vendor' },
        },
      },
    });
  }

  function listingDoc() {
    return JSON.stringify({
      data: {
        attributes: { name: 'Basic listing' },
        relationships: {
          vendor: { links: { self: './vendor' } },
        },
        meta: {
          adoptsFrom: { module: rri('./cards'), name: 'Listing' },
        },
      },
    });
  }

  test('the first render of a consumer contains its linked card’s data', async function (assert) {
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(row, 'the listing row exists');
    assert.ok(
      row!.isolated_html?.includes('Initech'),
      `the linked vendor's name is in the consumer's HTML (html: ${row!.isolated_html?.slice(
        0,
        2000,
      )})`,
    );
  });

  test('editing the linked card re-renders the consumer with the edit', async function (assert) {
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    let firstGeneration = row!.generation;

    await writeAndSettle('vendor.json', vendorDoc('Initrode'));
    let after = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(
      after!.generation > firstGeneration,
      'editing the linked card re-rendered the consumer',
    );
    assert.ok(
      after!.isolated_html?.includes('Initrode'),
      `the re-render shows the edited linked name (html: ${after!.isolated_html?.slice(
        0,
        2000,
      )})`,
    );
  });
});
