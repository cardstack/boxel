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
// data must appear in the consumer's HTML. Three write paths are pinned
// separately, because they exercise different indexing pipelines:
//   1. fixture-declared instances (the preparation-hook realm, from-scratch
//      indexed during setup);
//   2. instances written at test time (incremental index → prerender-html);
//   3. a re-render fanned out by editing the linked card.
// Assertions quote the HTML on failure so a red run carries the evidence.
function makeFileSystem() {
  return {
    'cards.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Vendor extends CardDef {
        @field name = contains(StringField);
        // A linksTo field component renders its target in FITTED format, so
        // the fitted template is the one whose output lands in the
        // consumer's HTML. (Without it, the default fitted layout renders —
        // card icon, cardTitle, display name — and never this card's own
        // fields, so an assertion on "name" tests the fixture, not the
        // pipeline.)
        static fitted = class Fitted extends Component<typeof this> {
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
    // Fixture-declared pair: indexed by the preparation hook's from-scratch
    // pass, no test-time writes involved.
    'fixture-vendor.json': {
      data: {
        attributes: { name: 'Globex' },
        meta: {
          adoptsFrom: { module: rri('./cards'), name: 'Vendor' },
        },
      },
    },
    'fixture-listing.json': {
      data: {
        attributes: { name: 'Fixture listing' },
        relationships: {
          vendor: { links: { self: './fixture-vendor' } },
        },
        meta: {
          adoptsFrom: { module: rri('./cards'), name: 'Listing' },
        },
      },
    },
  };
}

// Failure evidence: the persisted HTML with whitespace runs collapsed, so
// the quoted snippet spends its budget on markup rather than indentation.
function compactHTML(html: string | null | undefined): string {
  return (html ?? '(null)').replace(/\s+/g, ' ').slice(0, 3000);
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

  test('a fixture-declared consumer’s row contains its linked card’s data', async function (assert) {
    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}fixture-listing.json`,
    );
    assert.ok(row, 'the fixture listing row exists');
    assert.ok(
      row!.isolated_html?.includes('Globex'),
      `the linked vendor's name is in the consumer's HTML (html: ${compactHTML(
        row!.isolated_html,
      )})`,
    );
  });

  test('an incrementally written consumer’s row contains its linked card’s data', async function (assert) {
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(row, 'the listing row exists');
    let deps = (row!.deps ?? []) as string[];
    assert.ok(
      deps.some(
        (dep) =>
          dep === `${testRealm}vendor` || dep === `${testRealm}vendor.json`,
      ),
      `the linked vendor is a dep of the consumer's row (deps: ${JSON.stringify(
        deps,
      )})`,
    );
    assert.ok(
      row!.isolated_html?.includes('Initech'),
      `the linked vendor's name is in the consumer's HTML (html: ${compactHTML(
        row!.isolated_html,
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
      `the re-render shows the edited linked name (html: ${compactHTML(
        after!.isolated_html,
      )})`,
    );
  });
});
