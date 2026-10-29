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

function transform(code: string, options: Partial<Options> = {}): string {
  let result = babel.transformSync(code, {
    filename,
    configFile: false,
    babelrc: false,
    parserOpts: { plugins: ['typescript'] },
    plugins: [
      [exportIdentityPlugin, { moduleIdentifier: moduleURL, ...options }],
    ],
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
  'tags a marked definition for an exported binding': async (assert) => {
    assert.codeEqual(
      transform(`
        import { markDefinition } from '@cardstack/base';
        import enumField from '@cardstack/base/enum';
        export const DogStatus = markDefinition(enumField(StringField, { options: ['good'] }));
      `),
      `
        import { markDefinition } from '@cardstack/base';
        import enumField from '@cardstack/base/enum';
        export const DogStatus = markDefinition(enumField(StringField, { options: ['good'] }));
        if (typeof DogStatus === 'function' && !Object.prototype.hasOwnProperty.call(DogStatus, Symbol.for('ident'))) Object.defineProperty(DogStatus, Symbol.for('ident'), { value: ['https://example.com/pets/dog', 'DogStatus'], configurable: true, writable: true });
      `,
    );
  },

  'tags a marked definition exported through an export list': async (
    assert,
  ) => {
    assert.codeEqual(
      transform(`
        import { markDefinition } from '@cardstack/base';
        const Status = markDefinition(enumField(StringField, { options: ['good'] }));
        export { Status as DogStatus };
      `),
      `
        import { markDefinition } from '@cardstack/base';
        const Status = markDefinition(enumField(StringField, { options: ['good'] }));
        if (typeof Status === 'function' && !Object.prototype.hasOwnProperty.call(Status, Symbol.for('ident'))) Object.defineProperty(Status, Symbol.for('ident'), { value: ['https://example.com/pets/dog', 'DogStatus'], configurable: true, writable: true });
        export { Status as DogStatus };
      `,
    );
  },

  'tags a marked definition that is the default export': async (assert) => {
    assert.codeEqual(
      transform(`
        import { markDefinition } from '@cardstack/base';
        export default markDefinition(enumField(StringField, { options: ['good'] }));
      `),
      `
        import { markDefinition } from '@cardstack/base';
        const _default = markDefinition(enumField(StringField, { options: ['good'] }));
        if (typeof _default === 'function' && !Object.prototype.hasOwnProperty.call(_default, Symbol.for('ident'))) Object.defineProperty(_default, Symbol.for('ident'), { value: ['https://example.com/pets/dog', 'default'], configurable: true, writable: true });
        export default _default;
      `,
    );
  },

  'recognizes markDefinition imported under another name or through a namespace':
    async (assert) => {
      assert.codeEqual(
        transform(`
          import { markDefinition as mark } from '@cardstack/base';
          import * as base from '@cardstack/base';
          export const DogStatus = mark(enumField(StringField, { options: ['good'] })) as typeof StringField;
          export const TicketStatus = base.markDefinition(statusField({ options: [] }));
        `),
        `
          import { markDefinition as mark } from '@cardstack/base';
          import * as base from '@cardstack/base';
          export const DogStatus = mark(enumField(StringField, { options: ['good'] })) as typeof StringField;
          if (typeof DogStatus === 'function' && !Object.prototype.hasOwnProperty.call(DogStatus, Symbol.for('ident'))) Object.defineProperty(DogStatus, Symbol.for('ident'), { value: ['https://example.com/pets/dog', 'DogStatus'], configurable: true, writable: true });
          export const TicketStatus = base.markDefinition(statusField({ options: [] }));
          if (typeof TicketStatus === 'function' && !Object.prototype.hasOwnProperty.call(TicketStatus, Symbol.for('ident'))) Object.defineProperty(TicketStatus, Symbol.for('ident'), { value: ['https://example.com/pets/dog', 'TicketStatus'], configurable: true, writable: true });
        `,
      );
    },

  'refuses markDefinition imported by another spelling of the base package':
    async (assert) => {
      for (let source of [
        '@cardstack/base/mark-definition',
        // eslint-disable-next-line @cardstack/boxel/no-url-form-base-imports -- the alias spelling is what this case refuses
        'https://cardstack.com/base/mark-definition',
        // eslint-disable-next-line @cardstack/boxel/no-url-form-base-imports -- the alias spelling is what this case refuses
        'https://cardstack.com/base',
      ]) {
        assert.throws(
          () =>
            transform(`
              import { markDefinition } from '${source}';
              export const DogStatus = markDefinition(enumField(StringField, {}));
            `),
          /import markDefinition from '@cardstack\/base'/,
          source,
        );
      }
    },

  'refuses a marked definition that is not what an exported binding is declared with':
    async (assert) => {
      for (let code of [
        `const Status = markDefinition(enumField(StringField, {}));`,
        `export class Dog extends CardDef { static status = contains(markDefinition(enumField(StringField, {}))); }`,
        `export const Dog = makeCard(markDefinition(enumField(StringField, {})));`,
      ]) {
        assert.throws(
          () =>
            transform(`
              import { markDefinition } from '@cardstack/base';
              ${code}
            `),
          /markDefinition\(\) must be the value an exported binding is declared with/,
          code,
        );
      }
    },

  'leaves a call to an unmarked function alone': async (assert) => {
    assert.codeEqual(
      transform(`
        import enumField from '@cardstack/base/enum';
        export const DogStatus = enumField(StringField, { options: ['good'] });
      `),
      `
        import enumField from '@cardstack/base/enum';
        export const DogStatus = enumField(StringField, { options: ['good'] });
      `,
    );
  },

  'leaves values made by other functions alone': async (assert) => {
    assert.codeEqual(
      transform(`
        import { modifier } from 'ember-modifier';
        export const count = 1;
        export const bark = () => 'woof';
        export const key = Symbol.for('dog');
        export const setup = modifier(() => {});
        export const Alias = SomethingElse;
        export default makeField();
      `),
      `
        import { modifier } from 'ember-modifier';
        export const count = 1;
        export const bark = () => 'woof';
        export const key = Symbol.for('dog');
        export const setup = modifier(() => {});
        export const Alias = SomethingElse;
        export default makeField();
      `,
    );
  },
} as SharedTests<{}>);

export default tests;
