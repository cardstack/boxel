import * as babel from '@babel/core';
import {
  exportIdentityPlugin,
  type Options,
} from '../export-identity-plugin.ts';
import type { SharedTests } from '../helpers/index.ts';
import '../helpers/code-equality-assertion.ts';

const filename = '/realms/pets/dog.gts';

// Turns the on-disk filename into the module URL the realm serves it from.
function moduleURL(onDisk: string): string {
  return onDisk
    .replace(/^\/realms\//, 'https://example.com/')
    .replace(/\.gts$/, '');
}

function transform(
  code: string,
  options: Options = { moduleIdentifier: moduleURL },
): string {
  let result = babel.transformSync(code, {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['typescript'] },
    plugins: [[exportIdentityPlugin, options]],
  });
  if (!result?.code) {
    throw new Error('babel produced no output');
  }
  return result.code;
}

const tests = Object.freeze({
  'tags an exported class declaration with its name': async (assert) => {
    assert.codeEqual(
      transform(`
        export class Dog {
          bark() {}
        }
      `),
      `
        export class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Dog'];
          bark() {}
        }
      `,
    );
  },

  'tags a named default export class as "default"': async (assert) => {
    assert.codeEqual(
      transform(`
        export default class Dog {}
      `),
      `
        export default class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'default'];
        }
      `,
    );
  },

  'tags an anonymous default export class as "default"': async (assert) => {
    assert.codeEqual(
      transform(`
        export default class {}
      `),
      `
        export default class {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'default'];
        }
      `,
    );
  },

  'tags a class exported through an export list': async (assert) => {
    assert.codeEqual(
      transform(`
        class Dog {}
        export { Dog };
      `),
      `
        class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Dog'];
        }
        export { Dog };
      `,
    );
  },

  'uses the exported name, not the local name, of a renamed export': async (
    assert,
  ) => {
    assert.codeEqual(
      transform(`
        class Dog {}
        export { Dog as Puppy };
      `),
      `
        class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Puppy'];
        }
        export { Dog as Puppy };
      `,
    );
  },

  'tags a class exported under a string-literal name': async (assert) => {
    assert.codeEqual(
      transform(`
        class Dog {}
        export { Dog as 'good-dog' };
      `),
      `
        class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'good-dog'];
        }
        export { Dog as 'good-dog' };
      `,
    );
  },

  'tags a class exported by "export default <identifier>"': async (assert) => {
    assert.codeEqual(
      transform(`
        class Dog {}
        export default Dog;
      `),
      `
        class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'default'];
        }
        export default Dog;
      `,
    );
  },

  'tags an exported class expression with the variable name': async (
    assert,
  ) => {
    assert.codeEqual(
      transform(`
        export const Dog = class {};
      `),
      `
        export const Dog = class {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Dog'];
        };
      `,
    );
  },

  'tags a class expression whose binding is exported later': async (assert) => {
    assert.codeEqual(
      transform(`
        const Dog = class InnerDog {};
        export { Dog as Puppy };
      `),
      `
        const Dog = class InnerDog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Puppy'];
        };
        export { Dog as Puppy };
      `,
    );
  },

  'a class exported under several names takes the first in source order':
    async (assert) => {
      assert.codeEqual(
        transform(`
          class Dog {}
          export { Dog as Puppy };
          export default Dog;
          export { Dog };
        `),
        `
          class Dog {
            static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Puppy'];
          }
          export { Dog as Puppy };
          export default Dog;
          export { Dog };
        `,
      );
    },

  'leaves classes that are not exported alone': async (assert) => {
    assert.codeEqual(
      transform(`
        class Helper {}
        const Other = class {};
        export function make() {
          return class Local {};
        }
        export const instance = new (class Anonymous {})();
      `),
      `
        class Helper {}
        const Other = class {};
        export function make() {
          return class Local {};
        }
        export const instance = new (class Anonymous {})();
      `,
    );
  },

  'leaves classes re-exported from another module alone': async (assert) => {
    assert.codeEqual(
      transform(`
        import { Cat } from './cat';
        export { Cat };
        export { Bird } from './bird';
      `),
      `
        import { Cat } from './cat';
        export { Cat };
        export { Bird } from './bird';
      `,
    );
  },

  'leaves ambient and type-only exports alone': async (assert) => {
    assert.codeEqual(
      transform(`
        export declare class Ambient {}
        class Shape {}
        export type { Shape };
      `),
      `
        export declare class Ambient {}
        class Shape {}
        export type { Shape };
      `,
    );
  },

  'tags every exported class in a module': async (assert) => {
    assert.codeEqual(
      transform(`
        export class Dog {}
        class Cat {}
        export default class {}
        export { Cat as Kitten };
      `),
      `
        export class Dog {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Dog'];
        }
        class Cat {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'Kitten'];
        }
        export default class {
          static [Symbol.for('ident')] = ['https://example.com/pets/dog', 'default'];
        }
        export { Cat as Kitten };
      `,
    );
  },

  'passes the on-disk filename to the moduleIdentifier callback': async (
    assert,
  ) => {
    let received: string[] = [];
    let output = transform(`export class Dog {}`, {
      moduleIdentifier: (onDisk) => {
        received.push(onDisk);
        return 'pets/dog';
      },
    });
    assert.deepEqual(received, [filename]);
    assert.codeEqual(
      output,
      `
        export class Dog {
          static [Symbol.for('ident')] = ['pets/dog', 'Dog'];
        }
      `,
    );
  },

  'accepts a fixed string as the module identifier': async (assert) => {
    assert.codeEqual(
      transform(`export class Dog {}`, { moduleIdentifier: '@pets/dog' }),
      `
        export class Dog {
          static [Symbol.for('ident')] = ['@pets/dog', 'Dog'];
        }
      `,
    );
  },

  'leaves a file untagged when moduleIdentifier returns null': async (
    assert,
  ) => {
    assert.codeEqual(
      transform(
        `
          export class Dog {}
          class Cat {}
          export { Cat as Kitten };
          export default class {}
        `,
        { moduleIdentifier: () => null },
      ),
      `
        export class Dog {}
        class Cat {}
        export { Cat as Kitten };
        export default class {}
      `,
    );
  },
} as SharedTests<{}>);

export default tests;
