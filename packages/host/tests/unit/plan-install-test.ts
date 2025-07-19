import { module, test } from 'qunit';

import {
  PlanBuilder,
  planModuleInstall,
  planInstanceInstall,
  realmURL,
  ListingPathResolver,
  meta,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

const sourceRealmURL = new URL('https://localhost:4201/catalog/');
const targetRealmURL = new URL('https://localhost:4201/experiments/');
const baseRealmURL = new URL('https://cardstack.com/base/');

module('Unit | Catalog | Install Plan Builder', function () {
  module('planModuleInstall()', function () {
    module(
      'listing name provided (source folder derived from listing name)',
      function () {
        test('code exists outside of the source folder', function (assert) {
          const specs = [
            {
              ref: { name: 'Some Ref Name' },
              moduleHref: `${sourceRealmURL.href}some-folder/some`,
              [realmURL]: sourceRealmURL,
            },
            {
              ref: { name: 'Some Ref Name 2' },
              moduleHref: `${sourceRealmURL.href}some-folder-2/some-2`,
              [realmURL]: sourceRealmURL,
            },
          ] as Spec[];

          const listing = {
            name: 'Some Folder', // the source folder derived = /some-folder
            specs,
            examples: [],
            skills: [],
            [realmURL]: sourceRealmURL,
          } as any;
          const { modulesCopy } = planModuleInstall(
            specs,
            new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
          );

          assert.strictEqual(modulesCopy.length, 2);
          assert.deepEqual(modulesCopy[0], {
            sourceCodeRef: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
            },
            targetCodeRef: {
              name: 'Some Ref Name',
              module: `${targetRealmURL}some-folder-xyz/some-folder/some`,
            },
          });
          assert.deepEqual(modulesCopy[1], {
            sourceCodeRef: {
              name: 'Some Ref Name 2',
              module: `${sourceRealmURL.href}some-folder-2/some-2`,
            },
            targetCodeRef: {
              name: 'Some Ref Name 2',
              module: `${targetRealmURL}some-folder-xyz/some-folder-2/some-2`,
            },
          });
        });
      },
    );
    module('listing name NOT provided', function () {
      test('code exists in separate source folders', function (assert) {
        const specs = [
          {
            ref: { name: 'Some Ref Name' },
            moduleHref: `${sourceRealmURL.href}some-folder/some`,
            [realmURL]: sourceRealmURL,
          },
          {
            ref: { name: 'Some Ref Name 2' },
            moduleHref: `${sourceRealmURL.href}some-folder-2/some-2`,
            [realmURL]: sourceRealmURL,
          },
        ] as Spec[];

        const listing = {
          // note: we never provide listing name
          specs,
          examples: [],
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        const { modulesCopy } = planModuleInstall(
          specs,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );

        assert.strictEqual(modulesCopy.length, 2);
        assert.deepEqual(modulesCopy[0], {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some-folder/some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}xyz/some-folder/some`,
          },
        });
        assert.deepEqual(modulesCopy[1], {
          sourceCodeRef: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-folder-2/some-2`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 2',
            module: `${targetRealmURL}xyz/some-folder-2/some-2`,
          },
        });
      });
      test('code exists inside root of realm', function (assert) {
        const specs = [
          {
            ref: { name: 'Some Ref Name' },
            moduleHref: `${sourceRealmURL.href}some`,
            [realmURL]: sourceRealmURL,
          },
          {
            ref: { name: 'Some Ref Name 2' },
            moduleHref: `${sourceRealmURL.href}some-2`,
            [realmURL]: sourceRealmURL,
          },
        ] as Spec[];

        const listing = {
          specs,
          examples: [],
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        const { modulesCopy } = planModuleInstall(
          specs,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );

        assert.strictEqual(modulesCopy.length, 2);
        assert.deepEqual(modulesCopy[0], {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}xyz/some`,
          },
        });
        assert.deepEqual(modulesCopy[1], {
          sourceCodeRef: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-2`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 2',
            module: `${targetRealmURL}xyz/some-2`,
          },
        });
      });
    });
  });

  module('planInstanceInstall()', function () {
    module('listing name provided', function () {
      test('instance adoptsFrom from code inside base realm', function (assert) {
        const instances = [
          {
            id: `${sourceRealmURL.href}some-folder/Example/1`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name',
                module: `${baseRealmURL}skill`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
        ] as CardDef[];
        const listing = {
          name: 'Some Folder',
          specs: [],
          examples: instances,
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        let { modulesCopy, instancesCopy } = planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
        assert.strictEqual(modulesCopy.length, 0);
        assert.strictEqual(
          instancesCopy[0].lid,
          'some-folder-xyz/some-folder/Example/1',
        );
        assert.deepEqual(instancesCopy[0].targetCodeRef, {
          module: `${baseRealmURL}skill`,
          name: 'Some Ref Name',
        });
      });
      test('instance adoptsFrom code outside of source folder', function (assert) {
        const instances = [
          {
            id: `${sourceRealmURL.href}some-folder/Example/1`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name',
                module: `${sourceRealmURL.href}some-folder-2/some`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
        ] as CardDef[];
        const listing = {
          name: 'Some Folder',
          specs: [],
          examples: instances,
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        let { modulesCopy, instancesCopy } = planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
        assert.strictEqual(modulesCopy.length, 1);
        assert.deepEqual(modulesCopy[0], {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some-folder-2/some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}some-folder-xyz/some-folder-2/some`,
          },
        });
        assert.strictEqual(
          instancesCopy[0].lid,
          `some-folder-xyz/some-folder/Example/1`,
        );
        assert.deepEqual(instancesCopy[0].targetCodeRef, {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some-folder-2/some`,
        });
      });
    });
    module('listing name NOT provided', function () {
      test('instances adoptsFrom code from any folder', function (assert) {
        const instances = [
          {
            id: `${sourceRealmURL.href}some-folder/Example/1`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name 1',
                module: `${sourceRealmURL.href}some-folder/some`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
          {
            id: `${sourceRealmURL.href}some-folder-2/Example/2`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name 2',
                module: `${sourceRealmURL.href}some-folder-2/some-2`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
          {
            id: `${sourceRealmURL.href}some-folder-3/Example/3`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name 3',
                module: `${sourceRealmURL.href}some-3`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
        ] as CardDef[];
        const listing = {
          specs: [],
          examples: instances,
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        let { modulesCopy, instancesCopy } = planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
        assert.strictEqual(modulesCopy.length, 3);
        assert.strictEqual(instancesCopy.length, 3);

        assert.deepEqual(modulesCopy[0], {
          sourceCodeRef: {
            name: 'Some Ref Name 1',
            module: `${sourceRealmURL.href}some-folder/some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 1',
            module: `${targetRealmURL}xyz/some-folder/some`,
          },
        });

        assert.strictEqual(instancesCopy[0].lid, 'xyz/some-folder/Example/1');
        assert.deepEqual(instancesCopy[0].targetCodeRef, {
          name: 'Some Ref Name 1',
          module: `${targetRealmURL}xyz/some-folder/some`,
        });

        assert.deepEqual(modulesCopy[1], {
          sourceCodeRef: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-folder-2/some-2`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 2',
            module: `${targetRealmURL}xyz/some-folder-2/some-2`,
          },
        });

        assert.strictEqual(instancesCopy[1].lid, 'xyz/some-folder-2/Example/2');
        assert.deepEqual(instancesCopy[1].targetCodeRef, {
          name: 'Some Ref Name 2',
          module: `${targetRealmURL}xyz/some-folder-2/some-2`,
        });
      });
      test('instance adoptsFrom from code inside base realm', function (assert) {
        const instances = [
          {
            id: `${sourceRealmURL.href}some-folder/Example/1`,
            [meta]: {
              adoptsFrom: {
                name: 'Some Ref Name',
                module: `${baseRealmURL}skill`,
              },
            },
            [realmURL]: sourceRealmURL,
          },
        ] as CardDef[];
        const listing = {
          specs: [],
          examples: instances,
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        let { modulesCopy, instancesCopy } = planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
        assert.strictEqual(modulesCopy.length, 0);
        assert.strictEqual(instancesCopy[0].lid, 'xyz/some-folder/Example/1');
        assert.deepEqual(instancesCopy[0].targetCodeRef, {
          module: `${baseRealmURL}skill`,
          name: 'Some Ref Name',
        });
      });
    });
  });
  module('PlanBuilder', function (hooks) {
    let builder: PlanBuilder;
    const listing = {
      name: 'Some Folder',
      specs: [],
      examples: [],
      skills: [],
      [realmURL]: sourceRealmURL,
    } as any;
    hooks.beforeEach(function () {
      builder = new PlanBuilder(targetRealmURL.href, listing);
    });

    module('build()', function () {
      test('modulesCopy is deduplicated', function (assert) {
        builder.add(() => {
          return {
            modulesCopy: [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name',
                  module: `${sourceRealmURL.href}some-folder/some`,
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
              },
            ],
            instancesCopy: [],
          };
        });
        builder.add(() => {
          return {
            modulesCopy: [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name',
                  module: `${sourceRealmURL.href}some-folder/some`,
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
              },
            ],
            instancesCopy: [],
          };
        });
        let plan = builder.build();
        assert.deepEqual(plan, {
          instancesCopy: [],
          modulesCopy: [
            {
              sourceCodeRef: {
                module: `${sourceRealmURL.href}some-folder/some`,
                name: 'Some Ref Name',
              },
              targetCodeRef: {
                module: `${targetRealmURL}xyz/some-folder/some`,
                name: 'Some Ref Name',
              },
            },
          ],
          modulesToInstall: [
            {
              sourceModule: `${sourceRealmURL.href}some-folder/some`,
              targetModule: `${targetRealmURL}xyz/some-folder/some`,
            },
          ],
        });
      });
      test('instanceCopy is deduplicated', function (assert) {
        builder.add(() => {
          return {
            modulesCopy: [],
            instancesCopy: [
              {
                sourceCard: {} as CardDef,
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
                lid: 'xyz/some-folder/Example/1',
              },
            ],
          };
        });
        builder.add(() => {
          return {
            modulesCopy: [],
            instancesCopy: [
              {
                sourceCard: {} as CardDef,
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
                lid: 'xyz/some-folder/Example/1',
              },
            ],
          };
        });
        let plan = builder.build();
        assert.deepEqual(plan, {
          instancesCopy: [
            {
              sourceCard: {} as CardDef,
              targetCodeRef: {
                name: 'Some Ref Name',
                module: `${targetRealmURL}xyz/some-folder/some`,
              },
              lid: 'xyz/some-folder/Example/1',
            },
          ],
          modulesCopy: [],
          modulesToInstall: [],
        });
      });
    });
    module('modulesToInstall()', function () {
      test('sourceCodeRef that come from same module are deduplicated unless they have different target modules', function (assert) {
        builder.add(() => {
          return {
            modulesCopy: [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name',
                  module: `${sourceRealmURL.href}some-folder/some`,
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
              },
            ],
            instancesCopy: [],
          };
        });
        builder.add(() => {
          return {
            modulesCopy: [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name 2',
                  module: `${sourceRealmURL.href}some-folder/some`,
                },
                targetCodeRef: {
                  name: 'Some Ref Name 2',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
              },
            ],
            instancesCopy: [],
          };
        });
        builder.add(() => {
          return {
            modulesCopy: [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name 3',
                  module: `${sourceRealmURL.href}some-folder/some`,
                },
                targetCodeRef: {
                  name: 'Some Ref Name 3',
                  module: `${targetRealmURL}xyz/some-folder/some-3`,
                },
              },
            ],
            instancesCopy: [],
          };
        });
        let { modulesToInstall } = builder.build();
        assert.strictEqual(modulesToInstall.length, 2);
        assert.deepEqual(modulesToInstall[0], {
          sourceModule: `${sourceRealmURL.href}some-folder/some`,
          targetModule: `${targetRealmURL}xyz/some-folder/some`,
        });
        assert.deepEqual(modulesToInstall[1], {
          sourceModule: `${sourceRealmURL.href}some-folder/some`,
          targetModule: `${targetRealmURL}xyz/some-folder/some-3`,
        });
      });
    });
  });
});
