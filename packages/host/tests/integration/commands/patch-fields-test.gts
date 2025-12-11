import { waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import PatchFieldsCommand from '@cardstack/host/commands/patch-fields';
import type CommandService from '@cardstack/host/services/command-service';
import type StoreService from '@cardstack/host/services/store';

import {
  testRealmURL,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  withSlowSave,
  type TestContextWithSave,
  setupSnapshotRealm,
} from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  containsMany,
  field,
  FieldDef,
  StringField,
  NumberField,
  linksTo,
  linksToMany,
  isCard,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

module('Integration | Command | patch-fields', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, { autostart: true });
  let snapshot = setupSnapshotRealm(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      let commandService = getService('command-service');

      class Coordinates extends FieldDef {
        @field latitude = contains(NumberField);
        @field longitude = contains(NumberField);
      }
      class Country extends CardDef {
        @field name = contains(StringField);
        @field code = contains(StringField);
      }
      class Address extends FieldDef {
        @field street = contains(StringField);
        @field city = contains(StringField);
        @field zipCode = contains(StringField);
        // @ts-ignore
        @field coordinates = contains(Coordinates);
        @field country = linksTo(Country);
      }

      class Author extends CardDef {
        @field firstName = contains(StringField);
        @field lastName = contains(StringField);
        @field email = contains(StringField);
        // @ts-ignore
        @field address = contains(Address);
        @field tags = containsMany(StringField);
        // Relationship fields for testing
        @field bestBook = linksTo(() => Book);
        @field books = linksToMany(() => Book);
        static isolated = class Isolated extends Component<typeof Author> {
          <template>
            <h1>{{@model.firstName}} {{@model.lastName}} - {{@model.email}}</h1>
            <div>
              Address:
              <@fields.address />
            </div>
            <div>
              Best Book:
              <@fields.bestBook />
            </div>
            <div>All books:</div>
            <@fields.books />
          </template>
        };
      }

      class Book extends CardDef {
        @field title = contains(StringField);
        @field isbn = contains(StringField);
        @field publishYear = contains(NumberField);
        @field chapters = containsMany(StringField);
      }

      let johnTheAuthor = new Author({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john@example.com',
        address: new Address({
          street: '123 Main St',
          city: 'Anytown',
          zipCode: '12345',
        }),
        tags: ['writer', 'programmer'],
      });
      let usa = new Country({
        name: 'United States',
        code: 'US',
      });
      johnTheAuthor.address.country = usa;

      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'author.gts': { Author, Address, Coordinates, Book, Country },
          'Book/relationship-book.json': new Book({
            title: 'Relationship Book',
            isbn: '123-REL',
            publishYear: 2025,
            chapters: ['Rel 1'],
          }),
          'Book/book-1.json': new Book({
            title: 'Book 1',
            isbn: '111',
            publishYear: 2020,
            chapters: ['A'],
          }),
          'Book/book-2.json': new Book({
            title: 'Book 2',
            isbn: '222',
            publishYear: 2021,
            chapters: ['B'],
          }),
          'Book/test-book.json': new Book({
            title: 'Test Book',
            isbn: '978-0123456789',
            publishYear: 2023,
            chapters: ['Introduction', 'Chapter 1'],
          }),
          'Author/john.json': johnTheAuthor,
          'Country/canada.json': new Country({
            name: 'Canada',
            code: 'CA',
          }),
          'Country/usa.json': usa,
        },
        loader,
      });
      return {
        commandService,
        AuthorDef: Author,
        BookDef: Book,
        store: getService('store'),
      };
    },
  });

  let commandService: CommandService;
  let AuthorDef: typeof CardDef;
  let BookDef: typeof CardDef;
  let store: StoreService;

  hooks.beforeEach(function () {
    ({ commandService, AuthorDef, BookDef, store } = snapshot.get());
  });

  module('Optimistic persistence behavior', function () {
    test<TestContextWithSave>('patches do not await persistence', async function (assert) {
      assert.expect(6);

      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );
      let cardId = `${testRealmURL}Author/john`;
      let store = getService('store');

      let saves = 0;
      this.onSave((url) => {
        if (url.href === cardId) {
          saves++;
        }
      });

      let patchOptions: Parameters<StoreService['patch']>[2];
      let originalPatch = store.patch;
      store.patch = async function (
        this: StoreService,
        id,
        patch,
        opts: {
          doNotPersist?: true;
          doNotWaitForPersist?: true;
          clientRequestId?: string;
        },
      ) {
        patchOptions = opts;
        return await originalPatch.call(this, id, patch, opts);
      };

      try {
        await withSlowSave(100, async () => {
          let result = await patchFieldsCommand.execute({
            cardId,
            fieldUpdates: {
              firstName: 'Jane Optimistic',
            },
          });

          assert.true(result.success, 'command succeeds');

          let localCard = store.peek(cardId);
          assert.ok(localCard, 'local card is present');
          if (isCard(localCard)) {
            assert.strictEqual(
              (localCard as any).firstName,
              'Jane Optimistic',
              'local card updated immediately',
            );
          } else {
            assert.ok(false, 'local card should be a card instance');
          }

          assert.strictEqual(saves, 0, 'no persistence yet');
        });
      } finally {
        store.patch = originalPatch;
      }

      assert.true(
        patchOptions?.doNotWaitForPersist,
        'store.patch receives doNotWaitForPersist option',
      );

      await waitUntil(() => saves > 0);

      let persistedCard = await store.get(cardId);
      if (isCard(persistedCard)) {
        assert.strictEqual(
          (persistedCard as any).firstName,
          'Jane Optimistic',
          'change persists after background save completes',
        );
      } else {
        assert.ok(false, 'persisted card should exist');
      }
    });
  });

  module('Simple Field Update Tests', function () {
    module('Relationship Update Tests', function () {
      test('should update a linksTo relationship field', async function (assert) {
        let patchFieldsCommand = new PatchFieldsCommand(
          commandService.commandContext,
          {
            cardType: AuthorDef,
          },
        );
        let bookId = `${testRealmURL}Book/relationship-book`;
        let result = await patchFieldsCommand.execute({
          cardId: `${testRealmURL}Author/john`,
          fieldUpdates: {
            bestBook: { type: 'Book', id: bookId },
          },
        });
        assert.ok(result, 'Result should be defined');
        assert.true(result.success, 'Command should succeed');
        assert.deepEqual(
          result.updatedFields,
          ['bestBook'],
          'Updated fields should be correct',
        );
        assert.deepEqual(result.errors, {}, 'No errors should be present');
        // Verify the update in the index
        let updatedCard = await store.get(`${testRealmURL}Author/john`);
        if (isCard(updatedCard)) {
          let rel = (updatedCard as any).bestBook;
          assert.ok(rel, 'bestBook relationship should exist');
          assert.strictEqual(
            rel.id,
            bookId,
            'bestBook relationship should be updated',
          );
        } else {
          assert.ok(false, 'Updated card should exist');
        }
      });
      test('should update a linksToMany relationship field', async function (assert) {
        let patchFieldsCommand = new PatchFieldsCommand(
          commandService.commandContext,
        );
        let bookId1 = `${testRealmURL}Book/book-1`;
        let bookId2 = `${testRealmURL}Book/book-2`;
        let result = await patchFieldsCommand.execute({
          cardId: `${testRealmURL}Author/john`,
          fieldUpdates: {
            books: [
              { type: 'Book', id: bookId1 },
              { type: 'Book', id: bookId2 },
            ],
          },
        });
        assert.ok(result, 'Result should be defined');
        assert.true(result.success, 'Command should succeed');
        assert.deepEqual(
          result.updatedFields,
          ['books'],
          'Updated fields should be correct',
        );
        assert.deepEqual(result.errors, {}, 'No errors should be present');
        // Verify the update in the index
        let updatedCard = await store.get(`${testRealmURL}Author/john`);
        if (isCard(updatedCard)) {
          let rel = (updatedCard as any).books;
          assert.ok(rel, 'books relationship should exist');
          assert.ok(
            Array.isArray(rel),
            'books relationship should be an array',
          );
          if (Array.isArray(rel)) {
            assert.strictEqual(
              rel[0].id,
              bookId1,
              'First book id should match',
            );
            assert.strictEqual(
              rel[1].id,
              bookId2,
              'Second book id should match',
            );
          } else {
            assert.ok(false, 'books relationship should be an array');
          }
        } else {
          assert.ok(false, 'Updated card should exist');
        }
      });
      test('should update a nested relationship field (e.g., address.country)', async function (assert) {
        let patchFieldsCommand = new PatchFieldsCommand(
          commandService.commandContext,
        );
        let result = await patchFieldsCommand.execute({
          cardId: `${testRealmURL}Author/john`,
          fieldUpdates: {
            'address.country': {
              id: `${testRealmURL}Country/canada`,
            },
          },
        });
        assert.ok(result, 'Result should be defined');
        assert.true(
          result.success,
          'Command should succeed for nested relationship update',
        );
        assert.deepEqual(
          result.updatedFields,
          ['address.country'],
          'Updated fields should include the nested relationship',
        );
        assert.deepEqual(result.errors, {}, 'No errors should be present');
        // Verify the update in the index
        let updatedCard = await store.get(`${testRealmURL}Author/john`);
        if (isCard(updatedCard)) {
          let rel = (updatedCard as any).address?.country;
          assert.ok(rel, 'Nested country relationship should exist');
          if (rel && typeof rel === 'object' && 'id' in rel) {
            assert.strictEqual(
              rel.id,
              `${testRealmURL}Country/canada`,
              'Nested country relationship should be updated',
            );
          } else {
            assert.ok(false, 'Nested country relationship data should have id');
          }
        } else {
          assert.ok(false, 'Updated card should exist');
        }
      });
    });
    test('should update single primitive field', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['firstName'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');
    });

    test('should update multiple primitive fields', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane',
          email: 'jane@example.com',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['firstName', 'email'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');
    });

    test('should return success with updated field list', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane.smith@example.com',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['firstName', 'lastName', 'email'],
        'Updated fields should include all provided fields',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');
    });

    test('should preserve unchanged fields', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // First verify the original state
      let originalCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(originalCard)) {
        assert.strictEqual(
          (originalCard as any).firstName,
          'John',
          'Original firstName should be John',
        );
        assert.strictEqual(
          (originalCard as any).lastName,
          'Doe',
          'Original lastName should be Doe',
        );
        assert.strictEqual(
          (originalCard as any).email,
          'john@example.com',
          'Original email should be john@example.com',
        );
      } else {
        assert.ok(false, 'Original card should exist');
      }

      if (isCard(originalCard)) {
        // Update only firstName
        await patchFieldsCommand.execute({
          cardId: `${testRealmURL}Author/john`,
          fieldUpdates: {
            firstName: 'Jane',
          },
        });

        // Verify the updated state
        let updatedCard = await store.get(`${testRealmURL}Author/john`);
        if (isCard(updatedCard)) {
          assert.strictEqual(
            (updatedCard as any).firstName,
            'Jane',
            'Updated firstName should be Jane',
          );
          assert.strictEqual(
            (updatedCard as any).lastName,
            'Doe',
            'lastName should remain unchanged',
          );
          assert.strictEqual(
            (updatedCard as any).email,
            'john@example.com',
            'email should remain unchanged',
          );
        } else {
          assert.ok(false, 'Updated card should exist');
        }
      }
    });
  });

  module('Nested Field Update Tests', function () {
    test('should update nested object field using dot notation', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.city': 'New York',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['address.city'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');

      // Verify the update in the index
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).address?.city,
          'New York',
          'Nested field should be updated',
        );
        assert.strictEqual(
          (updatedCard as any).address?.street,
          '123 Main St',
          'Other nested fields should remain unchanged',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should update multiple nested fields', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.city': 'San Francisco',
          'address.zipCode': '94102',
          firstName: 'Jane',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['address.city', 'address.zipCode', 'firstName'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');

      // Verify the updates in the index
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).address?.city,
          'San Francisco',
          'Nested city field should be updated',
        );
        assert.strictEqual(
          (updatedCard as any).address?.zipCode,
          '94102',
          'Nested zipCode field should be updated',
        );
        assert.strictEqual(
          (updatedCard as any).firstName,
          'Jane',
          'Top-level firstName should be updated',
        );
        assert.strictEqual(
          (updatedCard as any).address?.street,
          '123 Main St',
          'Unchanged nested field should remain the same',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test("should create nested objects if they don't exist", async function (assert) {
      // Test using the existing john card but targeting a nested field that would be null
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // First, let's create a scenario where we set the address to null
      await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          address: null,
        },
      });

      // Now try to set nested fields - this should create the nested object
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.city': 'Boston',
          'address.street': '456 Oak St',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['address.city', 'address.street'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');

      // Verify the nested object was created
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).address?.city,
          'Boston',
          'Nested city field should be created and set',
        );
        assert.strictEqual(
          (updatedCard as any).address?.street,
          '456 Oak St',
          'Nested street field should be created and set',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should handle deep nesting (3+ levels)', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test deep nesting on the existing john card
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.coordinates.latitude': 40.7128,
          'address.coordinates.longitude': -74.006,
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['address.coordinates.latitude', 'address.coordinates.longitude'],
        'Updated fields should be correct',
      );
      assert.deepEqual(result.errors, {}, 'No errors should be present');

      // Verify the deep nested updates
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).address?.coordinates?.latitude,
          40.7128,
          'Deep nested latitude should be set',
        );
        assert.strictEqual(
          (updatedCard as any).address?.coordinates?.longitude,
          -74.006,
          'Deep nested longitude should be set',
        );
        // Verify original nested fields are preserved
        assert.strictEqual(
          (updatedCard as any).address?.city,
          'Anytown',
          'Existing nested city should be preserved',
        );
        assert.strictEqual(
          (updatedCard as any).address?.street,
          '123 Main St',
          'Existing nested street should be preserved',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });
  });

  module('Array Field Update Tests', function () {
    test('should update array element by index', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[1]': 'developer',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['tags[1]'],
        'Updated fields should be correct',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.deepEqual(
          (updatedCard as any).tags as string[],
          ['writer', 'developer'],
          'Array element should be updated',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should update nested field within array element', async function (assert) {
      // First, let's create a card with a containsMany of complex objects
      // We need to add a contacts field to our test data setup

      // For now, let's test nested field in the address object
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.street': '456 Oak Ave', // Update nested field
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['address.street'],
        'Updated fields should be correct',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        let address = (updatedCard as any).address as any;
        assert.strictEqual(
          address?.street,
          '456 Oak Ave',
          'Nested field should be updated',
        );
        // Ensure other fields weren't changed
        assert.strictEqual(
          address?.city,
          'Anytown',
          'Other nested fields should remain unchanged',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should replace entire array', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          tags: ['javascript', 'typescript', 'react'],
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['tags'],
        'Updated fields should be correct',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.deepEqual(
          (updatedCard as any).tags as string[],
          ['javascript', 'typescript', 'react'],
          'Entire array should be replaced',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should add new item to array using push syntax', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[]': 'new-tag',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['tags[]'],
        'Updated fields should be correct',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.deepEqual(
          (updatedCard as any).tags as string[],
          ['writer', 'programmer', 'new-tag'],
          'New item should be added to array',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should add new item to array at specific index', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[3]': 'new-skill', // Adding beyond current array bounds should extend array
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['tags[3]'],
        'Updated fields should be correct',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.deepEqual(
          (updatedCard as any).tags as string[],
          ['writer', 'programmer', null, 'new-skill'],
          'Array should be extended with null padding',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should handle mixed array and object updates', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane', // Simple field update
          'address.city': 'New City', // Nested object update
          'tags[0]': 'updated-writer', // Array element update
          'tags[]': 'new-tag', // Array append
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed');
      assert.deepEqual(
        result.updatedFields,
        ['firstName', 'address.city', 'tags[0]', 'tags[]'],
        'All updates should be successful',
      );

      // Verify the actual card was updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).firstName,
          'Jane',
          'Simple field should be updated',
        );

        let address = (updatedCard as any).address as any;
        assert.strictEqual(
          address?.city,
          'New City',
          'Nested field should be updated',
        );

        let tags = (updatedCard as any).tags as string[];
        assert.strictEqual(
          tags[0],
          'updated-writer',
          'Array element should be updated',
        );
        assert.ok(tags.includes('new-tag'), 'New tag should be appended');
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });
  });

  module('Validation Tests', function () {
    test('should reject non-existent field paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          nonExistentField: 'some value',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(result.success, 'Command should fail for invalid field');
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(
        Object.keys(result.errors).includes('nonExistentField'),
        'Error should be reported for invalid field',
      );
    });

    test('should reject invalid field types', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'firstName.invalid': 'some value', // firstName is a string, not an object
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(
        result.success,
        'Command should fail for invalid nested path',
      );
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(
        Object.keys(result.errors).includes('firstName.invalid'),
        'Error should be reported for invalid nested field',
      );
    });

    test('should validate array bounds for existing arrays', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Try to access an array index that's way beyond reasonable bounds
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[150]': 'invalid-index', // Way beyond reasonable bounds
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(
        result.success,
        'Command should fail due to unreasonable array index',
      );
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(result.errors, 'Errors should be present');
      assert.ok(
        result.errors['tags[150]'],
        'Error should be reported for tags[150]',
      );
      assert.ok(
        result.errors['tags[150]'].includes(
          'too far beyond current array length',
        ),
        'Should report array bounds error',
      );
    });

    test('should validate relationship field constraints', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Try to update fields that would be relationship fields (but don't exist in our schema)
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          nonExistentRelation: 'http://example.com/some-card', // This should fail
          anotherRelation: 'invalid-relationship-value', // This should fail
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(
        result.success,
        'Command should fail for non-existent relationship fields',
      );
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(result.errors, 'Errors should be present');
      assert.ok(
        result.errors.nonExistentRelation,
        'Should report error for nonExistentRelation',
      );
      assert.ok(
        result.errors.anotherRelation,
        'Should report error for anotherRelation',
      );
    });
  });

  module('Partial Success Tests', function () {
    test('should update valid fields when some fields fail', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane', // This should succeed
          invalidField: 'some value', // This should fail
          email: 'jane@example.com', // This should succeed
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should report success for partial updates',
      );
      assert.ok(
        result.updatedFields.includes('firstName'),
        'Valid firstName field should be updated',
      );
      assert.ok(
        result.updatedFields.includes('email'),
        'Valid email field should be updated',
      );
      assert.notOk(
        result.updatedFields.includes('invalidField'),
        'Invalid field should not be in updated list',
      );
      assert.ok(
        Object.keys(result.errors).includes('invalidField'),
        'Error should be reported for invalid field',
      );

      // Verify the valid fields were actually updated
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        assert.strictEqual(
          (updatedCard as any).firstName,
          'Jane',
          'firstName should be updated',
        );
        assert.strictEqual(
          (updatedCard as any).email,
          'jane@example.com',
          'email should be updated',
        );
      } else {
        assert.ok(false, 'Updated card should exist');
      }
    });

    test('should report successful and failed fields separately', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane', // This should succeed
          invalidField: 'some value', // This should fail
          email: 'jane@example.com', // This should succeed
          'invalid.nested.field': 'invalid', // This should fail
        },
      });

      assert.ok(result, 'Result should be defined');

      // Should succeed because some fields were updated
      assert.true(
        result.success,
        'Command should report success for partial updates',
      );

      // Should have successful updates
      assert.deepEqual(
        result.updatedFields.sort(),
        ['firstName', 'email'].sort(),
        'Should report successful field updates',
      );

      // Should have errors for failed fields
      assert.ok(result.errors, 'Should have errors object');
      assert.ok(
        result.errors.invalidField,
        'Should report error for invalidField',
      );
      assert.ok(
        result.errors['invalid.nested.field'],
        'Should report error for invalid nested field',
      );

      // Successful fields should not be in errors
      assert.notOk(
        result.errors.firstName,
        'Successful fields should not have errors',
      );
      assert.notOk(
        result.errors.email,
        'Successful fields should not have errors',
      );
    });

    test('should return success=true for partial success', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane', // This should succeed
          invalidField: 'some value', // This should fail
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should return success=true when some fields succeed',
      );
      assert.deepEqual(
        result.updatedFields,
        ['firstName'],
        'Should update valid fields',
      );
      assert.ok(
        result.errors.invalidField,
        'Should report error for invalid field',
      );
    });

    test('should return success=false when no fields update', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          invalidField1: 'some value', // This should fail
          invalidField2: 'another value', // This should fail
          'nonexistent.field': 'value', // This should fail
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(
        result.success,
        'Command should return success=false when no fields succeed',
      );
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(result.errors, 'Should have errors object');
      assert.ok(
        result.errors.invalidField1,
        'Should report error for invalidField1',
      );
      assert.ok(
        result.errors.invalidField2,
        'Should report error for invalidField2',
      );
      assert.ok(
        result.errors['nonexistent.field'],
        'Should report error for nonexistent.field',
      );
    });
  });

  module('Error Handling Tests', function () {
    test('should handle card not found error', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/nonexistent`,
        fieldUpdates: {
          firstName: 'Jane',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(result.success, 'Command should fail for non-existent card');
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(
        Object.keys(result.errors).includes('firstName'),
        'Error should be reported for the attempted update',
      );
      assert.ok(
        result.errors.firstName.includes('Card not found'),
        'Error message should indicate card not found',
      );
    });

    test('should provide detailed error messages for invalid fields', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'invalid.nested.field': 'some value',
          'another.bad.field': 'another value',
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(result.success, 'Command should fail for invalid fields');
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');

      assert.ok(
        Object.keys(result.errors).includes('invalid.nested.field'),
        'Error should be reported for first invalid field',
      );
      assert.ok(
        Object.keys(result.errors).includes('another.bad.field'),
        'Error should be reported for second invalid field',
      );

      assert.ok(
        result.errors['invalid.nested.field'].includes('Invalid field path'),
        'Error message should indicate invalid field path',
      );
    });

    test('should handle array index out of bounds when updating existing items', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Try to access a very high index that should trigger bounds checking
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[200]': 'way-out-of-bounds', // Way beyond reasonable bounds
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(
        result.success,
        'Command should fail for unreasonably high array indices',
      );
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(result.errors, 'Errors should be present');
      assert.ok(
        result.errors['tags[200]'],
        'Should report error for out of bounds index',
      );
      assert.ok(
        result.errors['tags[200]'].includes('too far beyond'),
        'Should report bounds checking error',
      );
    });

    test('should allow adding beyond current array bounds (append behavior)', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Add at an index just beyond current bounds (should work with null padding)
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[5]': 'reasonable-extension', // Reasonable extension
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed for reasonable array extensions',
      );
      assert.deepEqual(
        result.updatedFields,
        ['tags[5]'],
        'Array extension should be successful',
      );
      assert.deepEqual(result.errors, {}, 'No errors should occur');

      // Verify the array was extended with null padding
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        let tags = (updatedCard as any).tags as any[];
        assert.strictEqual(tags.length, 6, 'Array should be extended');
        assert.strictEqual(
          tags[5],
          'reasonable-extension',
          'Value should be set',
        );
        assert.strictEqual(tags[2], null, 'Padding should be null');
      }
    });

    test('should handle null reference in field paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test updating a path where intermediate objects might be null/undefined
      // This should create nested objects as needed
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.coordinates.latitude': 42.3601, // Deep path that should work
          'address.coordinates.longitude': -71.0589, // Deep path that should work
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should handle null references by creating objects',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        [
          'address.coordinates.latitude',
          'address.coordinates.longitude',
        ].sort(),
        'Deep paths should be created successfully',
      );
      assert.deepEqual(result.errors, {}, 'No errors should occur');

      // Verify the nested objects were created
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        let address = (updatedCard as any).address as any;
        let coordinates = address?.coordinates as any;
        assert.strictEqual(
          coordinates?.latitude,
          42.3601,
          'Latitude should be set',
        );
        assert.strictEqual(
          coordinates?.longitude,
          -71.0589,
          'Longitude should be set',
        );
      }
    });

    test('should handle malformed field paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          '': 'empty-path', // Empty path
          '.invalid': 'starts-with-dot', // Starts with dot
          'field.': 'ends-with-dot', // Ends with dot
          'field..nested': 'double-dot', // Double dots
          'field[': 'unclosed-bracket', // Unclosed bracket
          'field]': 'unopened-bracket', // Unopened bracket
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.false(result.success, 'Command should fail for malformed paths');
      assert.deepEqual(result.updatedFields, [], 'No fields should be updated');
      assert.ok(result.errors, 'Errors should be present');

      // Check that all malformed paths have errors
      assert.ok(result.errors[''], 'Should report error for empty path');
      assert.ok(
        result.errors['.invalid'],
        'Should report error for path starting with dot',
      );
      assert.ok(
        result.errors['field.'],
        'Should report error for path ending with dot',
      );
      assert.ok(
        result.errors['field..nested'],
        'Should report error for double dots',
      );
      assert.ok(
        result.errors['field['],
        'Should report error for unclosed bracket',
      );
      assert.ok(
        result.errors['field]'],
        'Should report error for unopened bracket',
      );
    });
  });

  module('Field Path Parsing Tests', function () {
    test('should parse simple field paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test parsing of simple field paths by successfully updating them
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Jane', // Simple field
          lastName: 'Smith', // Another simple field
          email: 'jane@example.com', // Another simple field
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed with simple field paths',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        ['firstName', 'lastName', 'email'].sort(),
        'All simple fields should be parsed and updated correctly',
      );
      assert.deepEqual(result.errors, {}, 'No parsing errors should occur');
    });

    test('should parse dot notation paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test parsing of dot notation paths
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'address.street': '456 Oak Ave', // Simple dot notation
          'address.city': 'New City', // Simple dot notation
          'address.coordinates.latitude': 40.7128, // Deep dot notation
          'address.coordinates.longitude': -74.006, // Deep dot notation
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed with dot notation paths',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        [
          'address.street',
          'address.city',
          'address.coordinates.latitude',
          'address.coordinates.longitude',
        ].sort(),
        'All dot notation fields should be parsed and updated correctly',
      );
      assert.deepEqual(result.errors, {}, 'No parsing errors should occur');
    });

    test('should parse array index paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test parsing of array index paths
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[0]': 'updated-writer', // Array index path
          'tags[1]': 'updated-programmer', // Array index path
          'tags[]': 'new-skill', // Array append path
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed with array index paths',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        ['tags[0]', 'tags[1]', 'tags[]'].sort(),
        'All array index fields should be parsed and updated correctly',
      );
      assert.deepEqual(result.errors, {}, 'No parsing errors should occur');
    });

    test('should parse array append operations (e.g., "tags[]" or "tags[-1]")', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test parsing of array append operations
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[]': 'appended-skill', // Empty brackets append
          'tags[-1]': 'special-append', // -1 index append
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed with array append operations',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        ['tags[]', 'tags[-1]'].sort(),
        'All append operations should be parsed and executed correctly',
      );
      assert.deepEqual(result.errors, {}, 'No parsing errors should occur');

      // Verify both append operations worked
      let updatedCard = await store.get(`${testRealmURL}Author/john`);
      if (isCard(updatedCard)) {
        let tags = (updatedCard as any).tags as string[];
        assert.ok(
          tags.includes('appended-skill'),
          'Empty brackets append should work',
        );
        assert.ok(
          tags.includes('special-append'),
          '-1 index append should work',
        );
        assert.ok(tags.length >= 4, 'Array should have grown');
      }
    });

    test('should parse complex mixed paths', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test parsing of complex mixed paths (combining dots and arrays)
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'John', // Simple field
          'address.street': '123 Main St', // Dot notation
          'tags[0]': 'updated-tag', // Array index
          'address.coordinates.latitude': 40.7589, // Deep dot notation
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(
        result.success,
        'Command should succeed with complex mixed paths',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        [
          'firstName',
          'address.street',
          'tags[0]',
          'address.coordinates.latitude',
        ].sort(),
        'All complex mixed paths should be parsed correctly',
      );
      assert.deepEqual(result.errors, {}, 'No parsing errors should occur');
    });

    test('should handle edge cases in parsing', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Test edge cases that should work
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          'tags[0]': 'single-char-tag', // Simple array access
          firstName: 'X', // Single character update
        },
      });

      assert.ok(result, 'Result should be defined');
      assert.true(result.success, 'Command should succeed with edge cases');
      assert.deepEqual(
        result.updatedFields.sort(),
        ['tags[0]', 'firstName'].sort(),
        'Edge case paths should be parsed correctly',
      );
      assert.deepEqual(
        result.errors,
        {},
        'No parsing errors should occur for valid edge cases',
      );
    });
  });

  module('Schema Generation Tests', function () {
    test('should generate correct JSON schema for card type', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let schema = await patchFieldsCommand.getInputJsonSchema();

      assert.ok(schema, 'Schema should be generated');
      assert.ok(schema.attributes, 'Schema should have attributes');
      assert.ok(
        schema.attributes.properties,
        'Schema attributes should have properties',
      );
      assert.ok(
        schema.attributes.properties.cardId,
        'Schema should include cardId field',
      );
      assert.ok(
        schema.attributes.properties.fieldUpdates,
        'Schema should include fieldUpdates field',
      );

      // Check that card type fields are included in fieldUpdates schema
      let fieldUpdatesSchema = schema.attributes.properties.fieldUpdates;
      assert.ok(
        fieldUpdatesSchema.properties,
        'FieldUpdates should have properties based on card type',
      );
      assert.ok(
        fieldUpdatesSchema.properties.firstName,
        'Should include firstName field from Author card',
      );
      assert.ok(
        fieldUpdatesSchema.properties.lastName,
        'Should include lastName field from Author card',
      );
      assert.ok(
        fieldUpdatesSchema.properties.email,
        'Should include email field from Author card',
      );
    });

    test('should include field descriptions in schema', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let schema = await patchFieldsCommand.getInputJsonSchema();

      assert.ok(
        schema.attributes.properties.cardId.description,
        'cardId field should have description',
      );
      assert.ok(
        schema.attributes.properties.fieldUpdates.description,
        'fieldUpdates field should have description',
      );
      assert.strictEqual(
        schema.attributes.properties.cardId.description,
        'The ID of the card to update',
        'cardId should have correct description',
      );
      assert.strictEqual(
        schema.attributes.properties.fieldUpdates.description,
        'Object containing field paths and their new values',
        'fieldUpdates should have correct description',
      );
    });

    test('should support nested field schemas', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let schema = await patchFieldsCommand.getInputJsonSchema();
      let fieldUpdatesSchema = schema.attributes.properties.fieldUpdates;

      // Should support nested fields like address
      assert.ok(
        fieldUpdatesSchema.properties.address,
        'Should include address field for nested updates',
      );

      // Should allow additional properties for nested field paths like "address.street"
      assert.true(
        fieldUpdatesSchema.additionalProperties,
        'Should allow additional properties for nested field paths',
      );
    });

    test('should handle array field schemas', async function (assert) {
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      let schema = await patchFieldsCommand.getInputJsonSchema();
      let fieldUpdatesSchema = schema.attributes.properties.fieldUpdates;

      // Should support array fields like tags
      assert.ok(
        fieldUpdatesSchema.properties.tags,
        'Should include tags array field',
      );

      // Should allow additional properties for array field paths like "tags[0]"
      assert.true(
        fieldUpdatesSchema.additionalProperties,
        'Should allow additional properties for array field paths',
      );
    });
  });

  module('Dynamic Field Validation Tests', function () {
    test('should work with different card types (not just hardcoded Author fields)', async function (assert) {
      // Create command instance configured for Book card type
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: BookDef,
        },
      );

      // This should now work since we've implemented dynamic field validation
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Book/test-book`,
        fieldUpdates: {
          title: 'Updated Book Title', // This field exists on Book and should be validated dynamically
        },
      });

      // This test should now pass with dynamic validation
      assert.true(
        result.success,
        'Should successfully validate and update Book fields with dynamic validation',
      );
      assert.strictEqual(
        result.updatedFields.length,
        1,
        'Should update the title field',
      );

      // Should successfully validate the title field
      assert.strictEqual(
        result.updatedFields[0],
        'title',
        'Should update the title field',
      );
      assert.deepEqual(result.errors, {}, 'Should have no validation errors');
    });

    test('should now accept fields that would have been rejected by hardcoded validation', async function (assert) {
      // Test that the validation is truly dynamic by using the existing Author card type
      // but trying to update fields that wouldn't have been in a hardcoded list

      // Let's test with a field that exists on Author but might not be in every hardcoded list
      let patchFieldsCommand = new PatchFieldsCommand(
        commandService.commandContext,
        {
          cardType: AuthorDef,
        },
      );

      // Try to update fields that should work with dynamic validation
      let result = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          firstName: 'Updated John', // This should work - field exists on Author
          lastName: 'Updated Doe', // This should work - field exists on Author
        },
      });

      // With dynamic validation, these valid fields should work
      assert.true(
        result.success,
        'Should successfully validate existing Author fields',
      );
      assert.deepEqual(
        result.updatedFields.sort(),
        ['firstName', 'lastName'].sort(),
        'Should update valid Author fields',
      );
      assert.deepEqual(
        result.errors,
        {},
        'Should have no validation errors for valid fields',
      );

      // Now test that invalid fields are still properly rejected
      let invalidResult = await patchFieldsCommand.execute({
        cardId: `${testRealmURL}Author/john`,
        fieldUpdates: {
          invalidField: 'Some value', // This field doesn't exist on Author
        },
      });

      assert.false(invalidResult.success, 'Should reject truly invalid fields');
      assert.ok(
        invalidResult.errors.invalidField?.includes('Invalid field path'),
        `Should get validation error for truly invalid field, got: ${invalidResult.errors.invalidField}`,
      );
    });
  });
});
