import { module, test } from 'qunit';

import {
  baseRealm,
  Loader,
  type ModuleEvaluator,
  type ModuleRegistration,
} from '@cardstack/runtime-common';

module('Unit | loader custom evaluator', function () {
  test('evaluates and caches a module graph through the supplied boundary', async function (assert) {
    let sources = new Map([
      [
        'https://sandbox.test/a.js',
        `
          import { b } from './b.js';
          export function a() { return 'a' + b(); }
        `,
      ],
      [
        'https://sandbox.test/b.js',
        `
          import { c } from './c.js';
          export function b() { return 'b' + c(); }
        `,
      ],
      [
        'https://sandbox.test/c.js',
        `
          export function c() { return 'c'; }
        `,
      ],
    ]);
    let fetch = async (input: RequestInfo | URL) => {
      let url = input instanceof Request ? input.url : String(input);
      let source = sources.get(url);
      return source == null
        ? new Response('not found', { status: 404 })
        : new Response(source, {
            headers: { 'content-type': 'text/javascript' },
          });
    };
    let evaluatedModules: string[] = [];
    let moduleEvaluator: ModuleEvaluator = (source, moduleIdentifier) => {
      evaluatedModules.push(moduleIdentifier);
      let registration: ModuleRegistration | undefined;
      let define = (
        _mid: string,
        dependencyList: string[],
        implementation: Function,
      ) => {
        registration = { dependencyList, implementation };
      };
      void define;
      eval(source);
      if (!registration) {
        throw new Error(`Module ${moduleIdentifier} did not register itself`);
      }
      return registration;
    };
    let loader = new Loader(fetch, undefined, { moduleEvaluator });

    try {
      let first = await loader.import<{ a(): string }>(
        'https://sandbox.test/a.js',
      );
      let second = await loader.import<{ a(): string }>(
        'https://sandbox.test/a.js',
      );

      assert.strictEqual(first.a(), 'abc');
      assert.strictEqual(second, first, 'module exports are cached');
      assert.deepEqual(evaluatedModules.sort(), [
        'https://sandbox.test/a.js',
        'https://sandbox.test/b.js',
        'https://sandbox.test/c.js',
      ]);
    } finally {
      loader.dispose();
    }
  });

  test('delegates trusted modules without taking over their identities', async function (assert) {
    let baseLoader = new Loader(async () => {
      throw new Error('the shimmed Base module should not fetch');
    });
    class SharedCardDef {}
    let moduleIdentifier = `${baseRealm.url}card-api`;
    let consumedModule = `${baseRealm.url}string`;
    baseLoader.shimModule(moduleIdentifier, { CardDef: SharedCardDef });

    let realmFetches = 0;
    let realmLoader = new Loader(
      async () => {
        realmFetches++;
        throw new Error('a delegated Base module should not fetch');
      },
      undefined,
      {
        moduleDelegate: async (requestedModule) =>
          requestedModule === moduleIdentifier
            ? {
                module:
                  await baseLoader.import<Record<string, unknown>>(
                    requestedModule,
                  ),
                consumedModules: [consumedModule],
              }
            : undefined,
      },
    );

    try {
      let delegated = await realmLoader.import<{
        CardDef: typeof SharedCardDef;
      }>(moduleIdentifier);

      assert.strictEqual(delegated.CardDef, SharedCardDef);
      assert.strictEqual(Loader.getLoaderFor(SharedCardDef), baseLoader);
      assert.strictEqual(realmFetches, 0);
      assert.deepEqual(realmLoader.getKnownConsumedModules(moduleIdentifier), [
        consumedModule,
      ]);
    } finally {
      realmLoader.dispose();
      baseLoader.dispose();
    }
  });

  test('invalidates an edited module and its dependents without discarding unrelated dependencies', async function (assert) {
    let sources = new Map([
      [
        'https://sandbox.test/preview.js',
        `import { value } from './value.js'; export const preview = value;`,
      ],
      ['https://sandbox.test/value.js', `export const value = 'first';`],
      ['https://sandbox.test/stable.js', `export const stable = true;`],
    ]);
    let evaluations = new Map<string, number>();
    let loader = new Loader(
      async (input) => {
        let url = input instanceof Request ? input.url : String(input);
        let source = sources.get(url);
        return source == null
          ? new Response('not found', { status: 404 })
          : new Response(source, {
              headers: { 'content-type': 'text/javascript' },
            });
      },
      undefined,
      {
        moduleEvaluator: (source, moduleIdentifier) => {
          evaluations.set(
            moduleIdentifier,
            (evaluations.get(moduleIdentifier) ?? 0) + 1,
          );
          let registration: ModuleRegistration | undefined;
          let define = (
            _mid: string,
            dependencyList: string[],
            implementation: Function,
          ) => {
            registration = { dependencyList, implementation };
          };
          void define;
          eval(source);
          if (!registration) {
            throw new Error(
              `Module ${moduleIdentifier} did not register itself`,
            );
          }
          return registration;
        },
      },
    );

    try {
      let first = await loader.import<{ preview: string }>(
        'https://sandbox.test/preview.js',
      );
      let stable = await loader.import<{ stable: boolean }>(
        'https://sandbox.test/stable.js',
      );
      assert.strictEqual(first.preview, 'first');

      sources.set(
        'https://sandbox.test/value.js',
        `export const value = 'second';`,
      );
      assert.strictEqual(
        loader.invalidateModule('https://sandbox.test/value.js'),
        2,
        'the edited module and its importing preview are removed',
      );

      let second = await loader.import<{ preview: string }>(
        'https://sandbox.test/preview.js',
      );
      let stableAgain = await loader.import<{ stable: boolean }>(
        'https://sandbox.test/stable.js',
      );
      assert.strictEqual(second.preview, 'second');
      assert.strictEqual(stableAgain, stable, 'unrelated module stays cached');
      assert.strictEqual(evaluations.get('https://sandbox.test/stable.js'), 1);
    } finally {
      loader.dispose();
    }
  });
});
