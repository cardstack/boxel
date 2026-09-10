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
// data must appear in the consumer's HTML. Four cases, each fanning out the
// consumer's render a different way:
//   1. fixture-declared instances (the preparation-hook realm, indexed from
//      scratch during setup) — consumer and target are visited within one
//      index pass, in an order this test does not control, so whether the
//      target is resident when the consumer renders is not pinned; the
//      assertion pins only that its data lands.
//   2. instances written at test time (incremental index → prerender-html) —
//      a cold cross-pass load: the target's own write spawns a separate
//      index pass from the consumer's, so the render tab crosses a job scope
//      between them and drops the target before the consumer hydrates.
//   3. a re-render fanned out by editing the linked INSTANCE — pins that the
//      re-rendered consumer shows the edited target value.
//   4. a re-render fanned out by editing the card MODULE — the target is
//      loaded from scratch across a loader-epoch reset (the module
//      invalidation re-mints the epoch, resetting the loader on top of the
//      empty store the scope crossing already leaves).
// Residency note: a prerender tab's instance residency is job-scoped —
// gc-card-store's observeIndexingJob drops it when the render scope crosses
// to a new index pass (see render.ts #buildModel, which observes before the
// loader-epoch block) — so a card rendered under one pass does not survive
// into a render spawned by a later write, and every render here after the
// first meets an empty store. The unit-level contract that a resident
// target is never served stale is pinned in
// packages/host/tests/unit/job-scoped-instance-residency-test.ts.
// Assertions quote the HTML on failure so a red run carries the evidence.
const CARDS_GTS = `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Vendor extends CardDef {
        @field name = contains(StringField);
        // A linksTo field component renders its target in FITTED format, so
        // this template is the one whose output lands in the consumer's
        // HTML. It must render a value only the INSTANCE carries: the
        // default fitted layout and the broken-link placeholder both render
        // the card-type display name, so an instance-carried field is the
        // one thing that separates a loaded target from a placeholder.
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
    `;

function makeFileSystem() {
  return {
    'cards.gts': CARDS_GTS,
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
    if (row) {
      assert.ok(
        row.isolated_html?.includes('Globex'),
        `the linked vendor's name is in the consumer's HTML (html: ${compactHTML(
          row.isolated_html,
        )})`,
      );
    }
  });

  test('an incrementally written consumer’s row contains its linked card’s data', async function (assert) {
    // Each settle carries a 60 s budget whose timeout message (job ids, ages)
    // is the evidence a stalled run needs — QUnit's default 60 s test timeout
    // would win that race and discard it.
    assert.timeout(240_000);
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(row, 'the listing row exists');
    if (row) {
      let deps = (row.deps ?? []) as string[];
      assert.ok(
        // The row's deps are the render's snapshot verbatim, and the
        // pipeline records a linksTo target in its `.json` spelling —
        // pinned, so a drift in the recorded form fails here rather than
        // hiding.
        deps.includes(`${testRealm}vendor.json`),
        `the linked vendor is a dep of the consumer's row (deps: ${JSON.stringify(
          deps,
        )})`,
      );
      assert.ok(
        row.isolated_html?.includes('Initech'),
        `the linked vendor's name is in the consumer's HTML (html: ${compactHTML(
          row.isolated_html,
        )})`,
      );
    }
  });

  test('editing the linked card re-renders the consumer with the edit', async function (assert) {
    assert.timeout(240_000);
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(row, 'the listing row exists');
    if (row) {
      let firstGeneration = row.generation;

      await writeAndSettle('vendor.json', vendorDoc('Initrode'));
      let after = await prerenderedHtmlRowFor(
        testDbAdapter,
        `${testRealm}listing.json`,
      );
      assert.ok(after, 'the listing row survives the re-render');
      if (after) {
        assert.ok(
          after.generation > firstGeneration,
          'editing the linked card re-rendered the consumer',
        );
        assert.ok(
          after.isolated_html?.includes('Initrode'),
          `the re-render shows the edited linked name (html: ${compactHTML(
            after.isolated_html,
          )})`,
        );
      }
    }
  });

  test('a module edit re-renders the consumer with a cold-loaded linked card', async function (assert) {
    assert.timeout(240_000);
    await writeAndSettle('vendor.json', vendorDoc('Initech'));
    await writeAndSettle('listing.json', listingDoc());

    let row = await prerenderedHtmlRowFor(
      testDbAdapter,
      `${testRealm}listing.json`,
    );
    assert.ok(row, 'the listing row exists');
    if (row) {
      let firstGeneration = row.generation;

      // A module edit re-mints the loader epoch. The render tab already
      // starts every render from an empty store — observeIndexingJob drops
      // residency when the render scope crosses to this write's index pass —
      // so the target is cold-loaded here as in the incremental case; what
      // this case adds is the epoch change, which also resets the loader so
      // the target's module is rebuilt before its instance is loaded.
      await writeAndSettle('cards.gts', `${CARDS_GTS}\n// epoch re-mint\n`);
      let after = await prerenderedHtmlRowFor(
        testDbAdapter,
        `${testRealm}listing.json`,
      );
      assert.ok(after, 'the listing row survives the module edit');
      if (after) {
        assert.ok(
          after.generation > firstGeneration,
          'the module edit re-rendered the consumer',
        );
        assert.ok(
          after.isolated_html?.includes('Initech'),
          `the cold-loaded linked card's name is in the re-rendered HTML (html: ${compactHTML(
            after.isolated_html,
          )})`,
        );
      }
    }
  });
});
