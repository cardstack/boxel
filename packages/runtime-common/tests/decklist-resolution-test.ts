import { VirtualNetwork } from '../virtual-network.ts';
import { createEnvironmentAwareFetch } from '#fetch';
import type { SharedTests } from '../helpers/index.ts';

const SERVE = 'https://realm-server.example.com/_packages';
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
});

export default tests;
