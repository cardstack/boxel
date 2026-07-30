import { module, test } from 'qunit';

import {
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
});
