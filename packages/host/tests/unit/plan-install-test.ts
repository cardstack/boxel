import { module, test } from 'qunit';

import {
  PlanBuilder,
  planModuleInstall,
  planInstanceInstall,
  realmURL,
  ListingPathResolver,
  meta,
  InstallPlan,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

const sourceRealmURL = new URL('https://localhost:4201/catalog/');
const targetRealmURL = new URL('https://localhost:4201/experiments/');
const baseRealmURL = new URL('https://cardstack.com/base/');

module('Unit | Catalog | Install Plan Builder', function () {
  test('when listing name is not provided, just provides uuid (in this case uuid="xyz")', function (assert) {
    const specs = [
      {
        ref: { name: 'Some Ref Name' },
        moduleHref: `${sourceRealmURL.href}some-folder/some`,
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
    const { modulesCopy, modulesToInstall } = planModuleInstall(
      specs,
      new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
    );

    assert.deepEqual(modulesCopy, [
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
    ]);
    assert.deepEqual(modulesToInstall, [
      {
        sourceModule: `${sourceRealmURL.href}some-folder/some`,
        targetModule: `${targetRealmURL}xyz/some-folder/some`,
      },
    ]);
  });
  module('planModuleInstall()', function () {
    test('can execute plan for modules', function (assert) {
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
        name: 'Some Listing',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let { modulesCopy, modulesToInstall } = planModuleInstall(
        specs,
        new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
      );
      assert.deepEqual(modulesCopy, [
        {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some-folder/some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}some-listing-xyz/some-folder/some`,
          },
        },
        {
          sourceCodeRef: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-folder-2/some-2`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 2',
            module: `${targetRealmURL}some-listing-xyz/some-folder-2/some-2`,
          },
        },
      ]);
      assert.deepEqual(modulesToInstall, [
        {
          sourceModule: `${sourceRealmURL.href}some-folder/some`,
          targetModule: `${targetRealmURL}some-listing-xyz/some-folder/some`,
        },
        {
          sourceModule: `${sourceRealmURL.href}some-folder-2/some-2`,
          targetModule: `${targetRealmURL}some-listing-xyz/some-folder-2/some-2`,
        },
      ]);
    });
    test('can execute plan for modules when all code exists inside root of realm', function (assert) {
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
        name: 'Some Listing',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const { modulesCopy, modulesToInstall } = planModuleInstall(
        specs,
        new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
      );

      assert.deepEqual(modulesCopy, [
        {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}some-listing-xyz/some`,
          },
        },
        {
          sourceCodeRef: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-2`,
          },
          targetCodeRef: {
            name: 'Some Ref Name 2',
            module: `${targetRealmURL}some-listing-xyz/some-2`,
          },
        },
      ]);
      assert.deepEqual(modulesToInstall, [
        {
          sourceModule: `${sourceRealmURL.href}some`,
          targetModule: `${targetRealmURL}some-listing-xyz/some`,
        },
        {
          sourceModule: `${sourceRealmURL.href}some-2`,
          targetModule: `${targetRealmURL}some-listing-xyz/some-2`,
        },
      ]);
    });
  });

  module('planInstanceInstall()', function () {
    test('can execute plan for instances when instance adoptsFrom code outside of source folder', function (assert) {
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
        name: 'Some Listing',
        specs: [],
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let { modulesCopy, instancesCopy, modulesToInstall } =
        planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
      assert.deepEqual(modulesCopy, [
        {
          sourceCodeRef: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some-folder-2/some`,
          },
          targetCodeRef: {
            name: 'Some Ref Name',
            module: `${targetRealmURL}some-listing-xyz/some-folder-2/some`,
          },
        },
      ]);
      assert.deepEqual(modulesToInstall, [
        {
          sourceModule: `${sourceRealmURL.href}some-folder-2/some`,
          targetModule: `${targetRealmURL}some-listing-xyz/some-folder-2/some`,
        },
      ]);
      assert.strictEqual(instancesCopy.length, 1);
      assert.strictEqual(
        instancesCopy[0].lid,
        `some-folder-xyz/some-folder/Example/1`,
      );
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-folder-xyz/some-folder-2/some`,
      });
    });
    test('can execute plan for instances when instance adoptsFrom from code inside base realm', function (assert) {
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
        name: 'Some Listing',
        specs: [],
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let { modulesCopy, instancesCopy, modulesToInstall } =
        planInstanceInstall(
          instances,
          new ListingPathResolver(targetRealmURL.href, listing, 'xyz'),
        );
      assert.deepEqual(modulesCopy, []);
      assert.deepEqual(modulesToInstall, []);
      assert.strictEqual(instancesCopy.length, 1);
      assert.strictEqual(instancesCopy[0].lid, 'xyz/some-folder/Example/1');
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        module: `${baseRealmURL}skill`,
        name: 'Some Ref Name',
      });
    });
  });

  module('PlanBuilder', function (hooks) {
    let builder: PlanBuilder;
    const listing = {
      name: 'Some Listing',
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
          return new InstallPlan(
            [
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
            [],
          );
        });
        builder.add(() => {
          return new InstallPlan(
            [
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
            [],
          );
        });
        let plan = builder.build();
        assert.deepEqual(
          plan,
          new InstallPlan(
            [
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
            [],
          ),
        );
      });
      test('instanceCopy is deduplicated', function (assert) {
        builder.add(() => {
          return new InstallPlan(
            [],
            [
              {
                sourceCard: {} as CardDef,
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
                lid: 'xyz/some-folder/Example/1',
              },
            ],
          );
        });
        builder.add(() => {
          return new InstallPlan(
            [],
            [
              {
                sourceCard: {} as CardDef,
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
                lid: 'xyz/some-folder/Example/1',
              },
            ],
          );
        });
        let plan = builder.build();
        assert.deepEqual(
          plan,

          new InstallPlan(
            [],
            [
              {
                sourceCard: {} as CardDef,
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: `${targetRealmURL}xyz/some-folder/some`,
                },
                lid: 'xyz/some-folder/Example/1',
              },
            ],
          ),
        );
      });
    });
    module('modulesToInstall()', function () {
      test('sourceCodeRef that come from same module are deduplicated unless they have different target modules', function (assert) {
        builder.add(() => {
          return new InstallPlan(
            [
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
            [],
          );
        });
        builder.add(() => {
          return new InstallPlan(
            [
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
            [],
          );
        });
        builder.add(() => {
          return new InstallPlan(
            [
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
            [],
          );
        });
        let { modulesToInstall } = builder.build();
        assert.deepEqual(modulesToInstall, [
          {
            sourceModule: `${sourceRealmURL.href}some-folder/some`,
            targetModule: `${targetRealmURL}xyz/some-folder/some`,
          },
          {
            sourceModule: `${sourceRealmURL.href}some-folder/some`,
            targetModule: `${targetRealmURL}xyz/some-folder/some-3`,
          },
        ]);
      });
    });
  });
});
