import { module, test } from 'qunit';

import { FieldPathParser } from '@cardstack/host/lib/field-path-parser';

import type { CardDef } from 'https://cardstack.com/base/card-api';

module('Unit | Utility | field-path-parser', function () {
  module('parseFieldPath', function () {
    test('should parse simple field paths', function (assert) {
      assert.deepEqual(FieldPathParser.parseFieldPath('firstName'), [
        'firstName',
      ]);
    });

    test('should parse dot notation paths', function (assert) {
      assert.deepEqual(FieldPathParser.parseFieldPath('address.city'), [
        'address',
        'city',
      ]);
      assert.deepEqual(
        FieldPathParser.parseFieldPath('author.address.street'),
        ['author', 'address', 'street'],
      );
    });

    test('should parse array index paths', function (assert) {
      assert.deepEqual(FieldPathParser.parseFieldPath('tags[0]'), [
        'tags',
        '[0]',
      ]);
      assert.deepEqual(FieldPathParser.parseFieldPath('authors[1].name'), [
        'authors',
        '[1]',
        'name',
      ]);
    });

    test('should parse array append operations', function (assert) {
      assert.deepEqual(FieldPathParser.parseFieldPath('tags[]'), [
        'tags',
        '[]',
      ]);
      assert.deepEqual(FieldPathParser.parseFieldPath('tags[-1]'), [
        'tags',
        '[-1]',
      ]);
    });

    test('should handle malformed paths', function (assert) {
      assert.throws(
        () => FieldPathParser.parseFieldPath(''),
        /non-empty string/,
      );
      assert.throws(
        () => FieldPathParser.parseFieldPath('.field'),
        /Malformed/,
      );
      assert.throws(
        () => FieldPathParser.parseFieldPath('field.'),
        /Malformed/,
      );
      assert.throws(
        () => FieldPathParser.parseFieldPath('field['),
        /missing closing bracket/,
      );
      assert.throws(
        () => FieldPathParser.parseFieldPath('field[abc]'),
        /Invalid array index/,
      );
    });
  });

  module('utility methods', function () {
    test('isArrayIndex should identify array indices', function (assert) {
      assert.true(FieldPathParser.isArrayIndex('[0]'));
      assert.true(FieldPathParser.isArrayIndex('[]'));
      assert.true(FieldPathParser.isArrayIndex('[-1]'));
      assert.false(FieldPathParser.isArrayIndex('field'));
      assert.false(FieldPathParser.isArrayIndex('['));
    });

    test('isAppendOperation should identify append operations', function (assert) {
      assert.true(FieldPathParser.isAppendOperation('[]'));
      assert.true(FieldPathParser.isAppendOperation('[-1]'));
      assert.false(FieldPathParser.isAppendOperation('[0]'));
      assert.false(FieldPathParser.isAppendOperation('[1]'));
    });

    test('extractArrayIndex should extract numeric indices', function (assert) {
      assert.strictEqual(FieldPathParser.extractArrayIndex('[0]'), 0);
      assert.strictEqual(FieldPathParser.extractArrayIndex('[5]'), 5);
      assert.strictEqual(FieldPathParser.extractArrayIndex('[]'), null);
      assert.strictEqual(FieldPathParser.extractArrayIndex('[-1]'), null);

      assert.throws(
        () => FieldPathParser.extractArrayIndex('field'),
        /not an array index/,
      );
    });
  });

  module('applyFieldUpdate', function () {
    test('should update simple contains fields', function (assert) {
      const obj = { attributes: { name: 'old' } };
      FieldPathParser.applyFieldUpdate(obj, ['name'], 'new', false);
      assert.strictEqual(obj.attributes.name, 'new');
    });

    test('should update simple linksTo fields', function (assert) {
      const obj = {
        relationships: {
          author: { links: { self: null } as Record<string, any> },
        },
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['author'],
        { id: 'http://test.realm/People/5' },
        true,
      );
      assert.deepEqual(obj.relationships.author, {
        links: { self: 'http://test.realm/People/5' },
      });
    });

    test('should update nested contains fields', function (assert) {
      const obj = { attributes: { address: { city: 'old' } } };
      FieldPathParser.applyFieldUpdate(obj, ['address', 'city'], 'new', false);
      assert.strictEqual(obj.attributes.address.city, 'new');
    });
    test('should update nested contains field below containsMany', function (assert) {
      const obj = {
        attributes: {
          products: [
            { name: 'shirt', price: 3 },
            { name: 'hat', price: 4 },
          ],
        },
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['products', '[1]', 'price'],
        5,
        false,
      );
      assert.strictEqual(obj.attributes.products[1].price, 5);
    });

    test('should update nested linksTo fields', function (assert) {
      const obj = {
        attributes: { address: { city: 'example' } },
        relationships: {
          'address.country': {
            links: { self: 'http://test.realm/Country/usa' },
          },
        },
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['address', 'country'],
        { id: 'http://test.realm/Country/canada' },
        true,
      );
      assert.strictEqual(
        obj.relationships['address.country'].links.self,
        'http://test.realm/Country/canada',
      );
    });

    test('should create nested objects if needed', function (assert) {
      const obj: any = {};
      FieldPathParser.applyFieldUpdate(
        obj,
        ['address', 'city'],
        'New York',
        false,
      );
      assert.strictEqual(obj.attributes.address.city, 'New York');
    });

    test('should update containsMany elements', function (assert) {
      const obj = { attributes: { tags: ['old'] } };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['tags'],
        ['new', 'borrowed', 'blue'],
        false,
      );
      assert.strictEqual(obj.attributes.tags[0], 'new');
      assert.strictEqual(obj.attributes.tags[1], 'borrowed');
      assert.strictEqual(obj.attributes.tags[2], 'blue');
    });

    test('should update containsMany element with index', function (assert) {
      const obj = { attributes: { tags: ['old'] } };
      FieldPathParser.applyFieldUpdate(obj, ['tags', '[0]'], 'new', false);
      assert.strictEqual(obj.attributes.tags[0], 'new');
    });
    test('should append to containsMany arrays', function (assert) {
      const obj = { attributes: { tags: ['existing'] } };
      FieldPathParser.applyFieldUpdate(obj, ['tags', '[]'], 'new', false);
      assert.deepEqual(obj.attributes.tags, ['existing', 'new']);
    });
    test('should update linksToMany elements', function (assert) {
      const obj = {
        relationships: {
          'tags.0': { links: { self: 'http://test.realm/Tag/A' } },
          'tags.1': { links: { self: 'http://test.realm/Tag/B' } },
          'tags.2': { links: { self: 'http://test.realm/Tag/C' } },
        } as Record<string, any>,
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['tags'],
        [{ id: 'http://test.realm/Tag/D' }, { id: 'http://test.realm/Tag/E' }],
        true,
      );
      assert.strictEqual(
        obj.relationships['tags.0'].links.self,
        'http://test.realm/Tag/D',
      );
      assert.strictEqual(
        obj.relationships['tags.1'].links.self,
        'http://test.realm/Tag/E',
      );
      assert.strictEqual(obj.relationships['tags.2'], undefined);
    });
    test('should update linksToMany element with index', function (assert) {
      const obj = {
        relationships: {
          'tags.0': { links: { self: 'http://test.realm/Tag/1' } },
        } as Record<string, any>,
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['tags', '[0]'],
        { id: 'http://test.realm/Tag/2' },
        true,
      );
      assert.strictEqual(
        obj.relationships['tags.0'].links.self,
        'http://test.realm/Tag/2',
      );
    });
    test('should append to linksToMany arrays', function (assert) {
      const obj = {
        relationships: {
          'tags.0': { links: { self: 'http://test.realm/Tag/1' } },
        } as Record<string, any>,
      };
      FieldPathParser.applyFieldUpdate(
        obj,
        ['tags', '[]'],
        { id: 'http://test.realm/Tag/2' },
        true,
      );
      assert.deepEqual(
        obj.relationships['tags.0'].links.self,
        'http://test.realm/Tag/1',
      );
      assert.deepEqual(
        obj.relationships['tags.1'].links.self,
        'http://test.realm/Tag/2',
      );
    });

    test('should extend containsMany arrays with null padding', function (assert) {
      const obj = { attributes: { tags: ['a'] } };
      FieldPathParser.applyFieldUpdate(obj, ['tags', '[3]'], 'new', false);
      assert.deepEqual(obj.attributes.tags, ['a', null, null, 'new']);
    });
  });

  module('validatedFieldPath', function () {
    test('should validate top-level contains field path', async function (assert) {
      const getFields = () => ({
        firstName: { fieldType: 'contains' },
        age: { fieldType: 'contains' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['firstName'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['firstName'],
        fieldType: 'contains',
      });
    });
    test('should validate nested contains field path', async function (assert) {
      const nestedCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === nestedCardType) {
          return { street: { fieldType: 'contains' } };
        }
        return {
          address: {
            fieldType: 'contains',
            card: nestedCardType,
          },
        };
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['address', 'street'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['address', 'street'],
        fieldType: 'contains',
      });
    });
    test('should validate containsMany field path', async function (assert) {
      const getFields = () => ({
        tags: { fieldType: 'containsMany' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['tags', '[0]'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['tags', '[0]'],
        fieldType: 'containsMany',
      });
    });
    test('should validate nested containsMany field path', async function (assert) {
      let containsManyCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === containsManyCardType) {
          return {
            name: { fieldType: 'contains' },
            price: { fieldType: 'contains' },
          };
        } else {
          return {
            products: { fieldType: 'containsMany', card: containsManyCardType },
          };
        }
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['products', '[1]', 'price'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['products', '[1]', 'price'],
        fieldType: 'contains',
      });
    });
    test('should validate top-level linksTo field path', async function (assert) {
      const getFields = () => ({
        firstName: { fieldType: 'contains' },
        pet: { fieldType: 'linksTo' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['pet'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['pet'],
        fieldType: 'linksTo',
      });
    });
    test('should validate linksToMany field path', async function (assert) {
      let linksToCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === linksToCardType) {
          return { name: { fieldType: 'contains' } };
        } else {
          return {
            firstName: { fieldType: 'contains' },
            pets: { fieldType: 'linksToMany', card: linksToCardType },
          };
        }
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['pets'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['pets'],
        fieldType: 'linksToMany',
      });
    });
    test('should validate linksToMany field path with index notation', async function (assert) {
      let linksToCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === linksToCardType) {
          return { name: { fieldType: 'contains' } };
        } else {
          return {
            firstName: { fieldType: 'contains' },
            pets: { fieldType: 'linksToMany', card: linksToCardType },
          };
        }
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['pets', '[0]'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['pets', '[0]'],
        fieldType: 'linksToMany',
      });
    });
    test('should validate nested linksTo field path', async function (assert) {
      const nestedCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === nestedCardType) {
          return { country: { fieldType: 'linksTo' } };
        }
        return {
          address: {
            fieldType: 'contains',
            card: nestedCardType,
          },
        };
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['address', 'country'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['address', 'country'],
        fieldType: 'linksTo',
      });
    });
    test('should validate nested linksToMany field path', async function (assert) {
      const nestedCardType = { isCardDef: true };
      const getFields = (cardType: any) => {
        if (cardType === nestedCardType) {
          return { routes: { fieldType: 'linksToMany' } };
        }
        return {
          address: {
            fieldType: 'contains',
            card: nestedCardType,
          },
        };
      };
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['address', 'routes', '[0]'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: true,
        parts: ['address', 'routes', '[0]'],
        fieldType: 'linksToMany',
      });
    });
    test('should reject non-existent fields', async function (assert) {
      const getFields = () => ({
        firstName: { fieldType: 'contains' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['nonExistent'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['nonExistent'],
        reason:
          'Field "nonExistent" does not exist on card type "[object Object]"',
      });
    });
    test('should reject array access on non-array fields', async function (assert) {
      const getFields = () => ({
        name: { fieldType: 'contains' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['name', '[0]'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['name', '[0]'],
        reason: 'Field "name" is not an array field',
      });
    });
    test('should reject traversing into linksTo relationship fields', async function (assert) {
      const getFields = () => ({
        author: { fieldType: 'linksTo' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['author', 'name'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['author', 'name'],
        reason: 'Cannot traverse into linksTo relationships',
      });
    });
    test('should reject traversing into linksToMany relationship fields', async function (assert) {
      const getFields = () => ({
        friends: { fieldType: 'linksToMany' },
      });
      const mockCardType = {
        isCardDef: true,
      } as unknown as typeof import('https://cardstack.com/base/card-api').CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['friends', '[0]', 'name'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['friends', '[0]', 'name'],
        reason: 'Cannot traverse into linksToMany relationships',
      });
    });
    test('should reject nesting with non-existent fields', async function (assert) {
      const getFields = () => ({
        name: { fieldType: 'contains' },
      });
      const mockCardType = {} as unknown as typeof CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['name', 'invalid'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['name', 'invalid'],
        reason: 'Invalid card type for contains field',
      });
    });
    test('should reject empty field paths', async function (assert) {
      const getFields = () => ({});
      const mockCardType = {} as unknown as typeof CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        [],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: [],
        reason: 'Field path cannot be empty',
      });
    });
    test('should reject paths starting with array indices', async function (assert) {
      const getFields = () => ({});
      const mockCardType = {} as unknown as typeof CardDef;

      const result = await FieldPathParser.validatedFieldPath(
        ['[0]'],
        mockCardType,
        getFields,
      );
      assert.deepEqual(result, {
        isValid: false,
        parts: ['[0]'],
        reason: 'Array index cannot be the first segment in the path',
      });
    });
  });
});
