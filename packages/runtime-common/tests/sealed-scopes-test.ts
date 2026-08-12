import type { SharedTests } from '../helpers/index.ts';
import { resolveSealedScopes, type DecklistLink } from '../import-map-file.ts';

const SERVE = 'https://realm.example.com/demo/_packages';
const REALM = 'https://realm.example.com/acme/';

// A store, as the load callback sees it: pack manifests keyed by their URL.
//
// `crm@2.0.0` was published against `greeter@1.2.0`, which was itself
// published against `palette@3.0.0`. That chain is the whole point — a
// two-level dependency has to work or none of this is worth having.
function store(): Record<string, DecklistLink> {
  return {
    [`${SERVE}/acme/crm@2.0.0/importmap.json`]: {
      imports: {
        'acme/greeter': '/demo/_packages/acme/greeter@1.2.0/index.js',
        'acme/greeter/': '/demo/_packages/acme/greeter@1.2.0/',
      },
    } as DecklistLink,
    [`${SERVE}/acme/greeter@1.2.0/importmap.json`]: {
      imports: { palette: '/demo/_packages/lib/palette@3.0.0/index.js' },
    } as DecklistLink,
    [`${SERVE}/lib/palette@3.0.0/importmap.json`]: {} as DecklistLink,
  };
}

function loaderOver(
  manifests: Record<string, DecklistLink>,
  seen?: string[],
): (url: string) => Promise<DecklistLink | undefined> {
  return async (url: string) => {
    seen?.push(url);
    return manifests[url];
  };
}

const tests = Object.freeze({
  'a pinned Version gets its sealed map as a scope': async (assert) => {
    let flat = await resolveSealedScopes({
      flat: {
        imports: { 'acme/crm': `${SERVE}/acme/crm@2.0.0/app.js` },
        scopes: {},
      },
      load: loaderOver(store()),
    });
    // The scope key is the Version's own URL prefix, so it applies to every
    // module inside it and to nothing else.
    assert.deepEqual(flat.scopes[`${SERVE}/acme/crm@2.0.0/`], {
      'acme/greeter': `${SERVE}/acme/greeter@1.2.0/index.js`,
      'acme/greeter/': `${SERVE}/acme/greeter@1.2.0/`,
    });
    // The sealed pin was written origin-relative — `/demo/_packages/…` — which
    // means "the package space of whichever host serves me". Resolved against
    // the Version's own URL, that lands on this host.
    assert.deepEqual(flat.scopes[`${SERVE}/acme/greeter@1.2.0/`], {
      palette: `${SERVE}/lib/palette@3.0.0/index.js`,
    });
  },

  'the walk is transitive and terminates': async (assert) => {
    let seen: string[] = [];
    // A cycle: two Versions that pin each other. Nothing stops an author
    // publishing this, so the walk has to survive it rather than trust that
    // nobody will.
    let manifests: Record<string, DecklistLink> = {
      [`${SERVE}/acme/a@1.0.0/importmap.json`]: {
        imports: { 'acme/b': '/demo/_packages/acme/b@1.0.0/index.js' },
      } as DecklistLink,
      [`${SERVE}/acme/b@1.0.0/importmap.json`]: {
        imports: { 'acme/a': '/demo/_packages/acme/a@1.0.0/index.js' },
      } as DecklistLink,
    };
    let flat = await resolveSealedScopes({
      flat: {
        imports: { 'acme/a': `${SERVE}/acme/a@1.0.0/index.js` },
        scopes: {},
      },
      load: loaderOver(manifests, seen),
    });
    assert.strictEqual(seen.length, 2, 'each Version is read once');
    assert.ok(flat.scopes[`${SERVE}/acme/a@1.0.0/`]);
    assert.ok(flat.scopes[`${SERVE}/acme/b@1.0.0/`]);
  },

  'a range-spelled pin gets no scope': async (assert) => {
    // `greeter@^1.0.0` is served by a redirect to an exact version, so a
    // scope keyed on the range would never match the module that actually
    // loads. Attaching one that silently never applies is worse than
    // attaching none, because it looks configured.
    let flat = await resolveSealedScopes({
      flat: {
        imports: {
          'acme/greeter': `${SERVE}/acme/greeter@%5E1.0.0/index.js`,
        },
        scopes: {},
      },
      load: loaderOver(store()),
    });
    assert.deepEqual(flat.scopes, {});
  },

  'an unreachable sealed map costs only that Version': async (assert) => {
    // Fails OPEN, unlike `extends`. Inheritance is a declared total
    // dependency and half an inherited map is a lie; a sealed lock is scoped
    // to one Version, so losing it should not take a realm's whole map down.
    let flat = await resolveSealedScopes({
      flat: {
        imports: {
          'acme/crm': `${SERVE}/acme/crm@2.0.0/app.js`,
          'acme/gone': `${SERVE}/acme/gone@9.9.9/index.js`,
        },
        scopes: {},
      },
      load: async (url) => {
        if (url.includes('gone')) {
          throw new Error('502');
        }
        return store()[url];
      },
    });
    assert.ok(
      flat.scopes[`${SERVE}/acme/crm@2.0.0/`],
      'the reachable Version still resolves',
    );
    assert.strictEqual(flat.scopes[`${SERVE}/acme/gone@9.9.9/`], undefined);
  },

  'a realm may override one sealed entry': async (assert) => {
    // The ruling's §3 "deliberate override": a realm that writes a scope over
    // a Version's prefix means it, and can read it back. Applied on top of
    // the sealed table rather than under it.
    let flat = await resolveSealedScopes({
      flat: {
        imports: { 'acme/crm': `${SERVE}/acme/crm@2.0.0/app.js` },
        scopes: {
          [`${SERVE}/acme/crm@2.0.0/`]: {
            'acme/greeter': `${REALM}patched-greeter.js`,
          },
        },
      },
      load: loaderOver(store()),
    });
    assert.deepEqual(flat.scopes[`${SERVE}/acme/crm@2.0.0/`], {
      'acme/greeter': `${REALM}patched-greeter.js`,
      // Untouched entries still come from the seal.
      'acme/greeter/': `${SERVE}/acme/greeter@1.2.0/`,
    });
  },
} as SharedTests<{}>);

export default tests;
