import { VirtualNetwork } from '../virtual-network.ts';
import { createEnvironmentAwareFetch } from '#fetch';
import type { SharedTests } from '../helpers/index.ts';

const SERVE = 'https://realm-server.example.com/demo/_packages';
const REALM = 'https://realm-server.example.com/acme/';

// The claim this file exists to prove:
//
//   One realm, one bare specifier, TWO versions of the library behind it,
//   chosen by WHICH MODULE IS ASKING.
//
// That is not a tuning knob, it is the thing today's virtual network cannot
// do at all. `importMap` is a flat prefix table of rewrite functions with no
// importer argument, so `palette` resolves to exactly one thing per realm.
// The only way to get a second version has been to copy the whole tree —
// which is why "remix" means duplicating ~180 files instead of writing a
// map. Scopes are what make the copy unnecessary.
function twoMajorDecklist() {
  return {
    // The realm-wide default: everyone gets v2 unless something says
    // otherwise.
    imports: {
      palette: `${SERVE}/lib/palette@2.0.0/index.js`,
    },
    // …except the legacy viewer, which is pinned to v1 because v2's `pick()`
    // took a name instead of an index and nobody has ported it yet. This is
    // the entire remix story in four lines of data.
    scopes: {
      [`${REALM}legacy-viewer/`]: {
        palette: `${SERVE}/lib/palette@1.0.0/index.js`,
      },
    },
  };
}

const tests: SharedTests<unknown> = Object.freeze({
  'two majors of one library coexist, chosen by importer': async (assert) => {
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(twoMajorDecklist());

    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'the gallery gets v2 from the realm-wide import',
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}legacy-viewer/scene.gts`),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'the legacy viewer gets v1 from its scope — same specifier, same realm',
    );
  },

  'the scope applies to the whole subtree beneath it': async (assert) => {
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(twoMajorDecklist());
    assert.strictEqual(
      vn.resolveImport(
        'palette',
        `${REALM}legacy-viewer/deep/nested/thing.gts`,
      ),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'a module nested under the scope is still governed by it',
    );
  },

  'a sibling whose name merely starts with the scope is NOT governed': async (
    assert,
  ) => {
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(twoMajorDecklist());
    // `legacy-viewer-experiments/` shares a prefix with `legacy-viewer/` but
    // is a different directory. A scope key ending in `/` is a path prefix,
    // not a string prefix — getting this wrong silently hands the wrong
    // major to a neighbouring module, which is the kind of bug that gets
    // diagnosed as "the library is broken".
    assert.strictEqual(
      vn.resolveImport(
        'palette',
        `${REALM}legacy-viewer-experiments/scene.gts`,
      ),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'the neighbour falls back to the realm-wide v2',
    );
  },

  'with no decklist, resolution is byte-identical to the handler chain': async (
    assert,
  ) => {
    // The no-regression property. Not a spot check of three specifiers: the
    // same VirtualNetwork resolves a corpus twice — once with a decklist
    // loaded and once cleared — and every answer that the decklist does not
    // claim must be unchanged.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addRealmMapping(REALM, 'https://real.example.com/acme/');

    let corpus = [
      [`${REALM}card-api`, undefined],
      [`${REALM}deep/module.gts`, `${REALM}other.gts`],
      ['https://elsewhere.example.com/thing.js', `${REALM}a.gts`],
      ['./relative.gts', `${REALM}a.gts`],
      ['some-bare-name', `${REALM}a.gts`],
    ] as const;

    let before = corpus.map(([s, from]) => vn.resolveImport(s, from));
    vn.addDecklist(twoMajorDecklist());
    let after = corpus.map(([s, from]) => vn.resolveImport(s, from));

    for (let i = 0; i < corpus.length; i++) {
      assert.strictEqual(
        after[i],
        before[i],
        `unchanged by the decklist: ${corpus[i][0]}`,
      );
    }
  },

  'an importer-less caller still resolves the realm-wide import': async (
    assert,
  ) => {
    // Most of the dozen call sites pass no importer. They must not break;
    // they simply get the unscoped answer.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(twoMajorDecklist());
    assert.strictEqual(
      vn.resolveImport('palette'),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'no importer means no scope, not an error',
    );
  },
  'a hand-written decklist uses relative paths and stays portable': async (
    assert,
  ) => {
    // What a user actually types into a realm's importmap.json. No host
    // name anywhere: the realm it lives in is the base. If this needed
    // absolute URLs the file could not be committed, moved between
    // environments, or sensibly hand-edited — which is the whole point of
    // it being a file in the realm rather than server configuration.
    let authored = {
      imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' },
      scopes: {
        'legacy-viewer/': {
          palette: '/demo/_packages/lib/palette@1.0.0/index.js',
        },
      },
    };
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(authored, REALM);

    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'a root-relative value resolves against the realm origin',
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}legacy-viewer/scene.gts`),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'a relative scope key resolves against the realm too, and matches',
    );
  },

  'two realms pin the same library differently, and neither wins': async (
    assert,
  ) => {
    // The reason `setRealmDecklist` exists. Each realm's decklist is a card
    // in that realm, so with two workspaces open there are two maps in one
    // VirtualNetwork. Folded into a single global `imports` table they would
    // overwrite each other and the winner would depend on load order — a bug
    // that reproduces only when both realms are open, in whichever order the
    // user happened to open them. Installing each realm's imports as a scope
    // over that realm makes the importer decide, which is the mechanism
    // scopes already provide.
    let other = 'https://realm-server.example.com/other/';
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.setRealmDecklist(REALM, {
      imports: { palette: '/demo/_packages/lib/palette@1.0.0/index.js' },
    });
    vn.setRealmDecklist(other, {
      imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' },
    });

    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}scene.gts`),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'acme keeps v1',
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${other}scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'other keeps v2 — loaded second, and it did not clobber acme',
    );
  },

  "a realm's own scopes still beat its realm-wide default": async (assert) => {
    // Installing a realm's `imports` as `scopes[realmURL]` must not cost the
    // realm its ability to override itself for a subtree. It doesn't, because
    // import-maps resolution takes the LONGEST matching scope and the realm's
    // own scope keys resolve to URLs nested beneath the realm.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.setRealmDecklist(REALM, {
      imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' },
      scopes: {
        'legacy-viewer/': {
          palette: '/demo/_packages/lib/palette@1.0.0/index.js',
        },
      },
    });
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}legacy-viewer/scene.gts`),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'the nested scope wins over the realm-wide default',
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'and everything else still gets the default',
    );
  },

  'reloading a realm decklist replaces it, dropping retracted pins': async (
    assert,
  ) => {
    // The card is edited repeatedly, so this path runs constantly. An
    // additive table can never forget: remove a pin from the card, reload,
    // and the deleted entry would still be answering — the user would see
    // their edit do nothing and reasonably conclude the feature is broken.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.setRealmDecklist(REALM, {
      imports: {
        palette: '/demo/_packages/lib/palette@1.0.0/index.js',
        retracted: '/demo/_packages/lib/gone@1.0.0/index.js',
      },
      scopes: {
        'legacy-viewer/': {
          palette: '/demo/_packages/lib/palette@1.0.0/index.js',
        },
      },
    });
    // The edited card: palette bumped, `retracted` and the scope deleted.
    vn.setRealmDecklist(REALM, {
      imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' },
    });

    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'the bumped pin took effect',
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}legacy-viewer/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'the deleted scope is gone, so legacy-viewer falls back to the default',
    );
    assert.notStrictEqual(
      vn.resolveImport('retracted', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/gone@1.0.0/index.js`,
      'the deleted import is gone too',
    );
  },

  'addDecklist accumulates, which is exactly why realms do not use it': async (
    assert,
  ) => {
    // The distinction the two methods exist to draw, asserted rather than
    // described. `addDecklist` merges — correct for its callers, who each
    // contribute a piece of one map. Run a realm's reloads through it and a
    // retracted pin would never go away, so this pins the difference: if
    // someone later "simplifies" the two methods into one, one of these two
    // tests fails and says which behaviour was lost.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(
      { imports: { retracted: '/demo/_packages/lib/gone@1.0.0/index.js' } },
      REALM,
    );
    vn.addDecklist(
      { imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' } },
      REALM,
    );
    assert.strictEqual(
      vn.resolveImport('retracted', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/gone@1.0.0/index.js`,
      'the earlier entry survives the second call — additive, as documented',
    );
  },

  'removing a realm decklist takes its pins with it': async (assert) => {
    // Closing a workspace, or deleting the card.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.setRealmDecklist(REALM, {
      imports: { palette: '/demo/_packages/lib/palette@1.0.0/index.js' },
    });
    let pinned = vn.resolveImport('palette', `${REALM}gallery/scene.gts`);
    vn.setRealmDecklist(REALM, undefined);
    assert.notStrictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      pinned,
      'the pin no longer applies once the realm decklist is removed',
    );
  },

  'editing the decklist changes what resolves': async (assert) => {
    // The user-facing promise: this is a file you edit. Change the pin,
    // reload, get different code. Modelled here as a fresh load of an
    // edited map, which is what a reload does.
    let vn = new VirtualNetwork(createEnvironmentAwareFetch());
    vn.addDecklist(
      { imports: { palette: '/demo/_packages/lib/palette@1.0.0/index.js' } },
      REALM,
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@1.0.0/index.js`,
      'before the edit: v1',
    );

    vn.clearDecklist();
    vn.addDecklist(
      { imports: { palette: '/demo/_packages/lib/palette@2.0.0/index.js' } },
      REALM,
    );
    assert.strictEqual(
      vn.resolveImport('palette', `${REALM}gallery/scene.gts`),
      `${SERVE}/lib/palette@2.0.0/index.js`,
      'after the edit: v2 — one line of JSON, no code touched',
    );
  },
});

export default tests;
