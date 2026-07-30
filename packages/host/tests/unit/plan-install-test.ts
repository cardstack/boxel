import { module, test } from 'qunit';

import {
  PlanBuilder,
  planModuleInstall,
  planInstanceInstall,
  realmURL,
  ListingPathResolver,
  meta,
  InstallPlan,
  rri,
  VirtualNetwork,
} from '@cardstack/runtime-common';

import type { CardDef } from '@cardstack/base/card-api';
import type { Spec } from '@cardstack/base/spec';

const sourceRealmURL = new URL('https://localhost:4201/catalog/');
const targetRealmURL = new URL('https://localhost:4201/experiments/');
// The symbolic alias base is still served under, and the real URL backing it.
const baseRealmURL = new URL('https://cardstack.com/base/');
const resolvedBaseRealmURL = new URL('https://localhost:4201/base/');
const baseRealmRRI = '@cardstack/base/';
const foreignRealmURL = new URL('https://localhost:4201/user1/personal-realm/');

// Register the base realm the same way the host's network service does at
// construction (see `packages/host/app/services/network.ts`) — a URL mapping for
// the `cardstack.com` alias plus the scoped prefix. Without both, a bare
// VirtualNetwork can't recognize the real backing URL or the alias as base, and
// the planner's canonicalization has nothing to fold onto.
const virtualNetwork = new VirtualNetwork();
virtualNetwork.addURLMapping(baseRealmURL, resolvedBaseRealmURL);
virtualNetwork.addRealmMapping(baseRealmRRI, resolvedBaseRealmURL.href);

module('Unit | Catalog | Install Plan Builder', function () {
  test('when listing name is not provided, just provides uuid (in this case uuid="xyz")', function (assert) {
    const specs = [
      {
        ref: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
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
      new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      ),
      virtualNetwork,
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
          ref: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some-folder/some`,
          },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
        {
          ref: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-folder-2/some-2`,
          },
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
        new ListingPathResolver(
          targetRealmURL.href,
          listing,
          'xyz',
          virtualNetwork,
        ),
        virtualNetwork,
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
          ref: {
            name: 'Some Ref Name',
            module: `${sourceRealmURL.href}some`,
          },
          moduleHref: `${sourceRealmURL.href}some`,
          [realmURL]: sourceRealmURL,
        },
        {
          ref: {
            name: 'Some Ref Name 2',
            module: `${sourceRealmURL.href}some-2`,
          },
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
        new ListingPathResolver(
          targetRealmURL.href,
          listing,
          'xyz',
          virtualNetwork,
        ),
        virtualNetwork,
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

    // `Spec.moduleHref` is deliberately a resolved real URL (readers like the
    // source-file reader can't take an RRI), so it is the wrong input for
    // planning: a base-realm spec's `moduleHref` is the environment-specific
    // backing URL, which no base-realm check should have to recognize. The
    // canonical ref lives on `spec.ref`. (CS-12078)
    test('base-realm spec is not copied, and ref takes precedence over moduleHref', function (assert) {
      const specs = [
        {
          ref: { name: 'Skill', module: `${baseRealmRRI}skill` },
          moduleHref: `${resolvedBaseRealmURL}skill`,
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
        new ListingPathResolver(
          targetRealmURL.href,
          listing,
          'xyz',
          virtualNetwork,
        ),
        virtualNetwork,
      );
      assert.deepEqual(modulesCopy, []);
      assert.deepEqual(modulesToInstall, []);
    });

    test('spec with no ref module is skipped rather than planned as undefined', function (assert) {
      const specs = [
        { ref: { name: 'Some Ref Name' }, [realmURL]: sourceRealmURL },
      ] as unknown as Spec[];
      const listing = {
        name: 'Some Listing',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const { modulesCopy, modulesToInstall } = planModuleInstall(
        specs,
        new ListingPathResolver(
          targetRealmURL.href,
          listing,
          'xyz',
          virtualNetwork,
        ),
        virtualNetwork,
      );
      assert.deepEqual(modulesCopy, []);
      assert.deepEqual(modulesToInstall, []);
    });

    // The catalog is a prefix-mapped realm in production, so a listing's own
    // specs canonicalize to `@cardstack/catalog/…`. The plan must still resolve
    // in-realm paths correctly and still hand the copy step a fetchable URL.
    test('spec in a prefix-mapped (non-base) source realm still copies correctly', function (assert) {
      let mappedNetwork = new VirtualNetwork();
      mappedNetwork.addURLMapping(baseRealmURL, resolvedBaseRealmURL);
      mappedNetwork.addRealmMapping(baseRealmRRI, resolvedBaseRealmURL.href);
      mappedNetwork.addRealmMapping('@cardstack/catalog/', sourceRealmURL.href);

      const specs = [
        {
          ref: {
            name: 'Some Ref Name',
            module: '@cardstack/catalog/some-folder/some',
          },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
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
      const { modulesToInstall } = planModuleInstall(
        specs,
        new ListingPathResolver(
          targetRealmURL.href,
          listing,
          'xyz',
          mappedNetwork,
        ),
        mappedNetwork,
      );
      assert.deepEqual(modulesToInstall, [
        {
          // Fetchable: the copy step reads this with `new URL`.
          sourceModule: `${sourceRealmURL.href}some-folder/some`,
          targetModule: `${targetRealmURL}some-listing-xyz/some-folder/some`,
        },
      ]);
    });

    // The copy step reads `sourceModule` with `new URL`, so a prefix that
    // resolves to nothing has to fail here rather than being handed onward as an
    // unusable identifier.
    test('spec whose realm prefix has no mapping fails during planning', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name', module: '@nobody/nowhere/some' },
          [realmURL]: sourceRealmURL,
        },
      ] as unknown as Spec[];
      const listing = {
        name: 'Some Listing',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      assert.throws(
        () =>
          planModuleInstall(
            specs,
            new ListingPathResolver(
              targetRealmURL.href,
              listing,
              'xyz',
              virtualNetwork,
            ),
            virtualNetwork,
          ),
        /Cannot resolve module "@nobody\/nowhere\/some" to a fetchable URL/,
      );
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
          new ListingPathResolver(
            targetRealmURL.href,
            listing,
            'xyz',
            virtualNetwork,
          ),
          virtualNetwork,
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
        `some-listing-xyz/some-folder/Example/1`,
      );
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-listing-xyz/some-folder-2/some`,
      });
    });
    // A base-realm module ref reaches the planner in three spellings: the
    // canonical prefix, the symbolic `cardstack.com` alias, and the real backing
    // URL the alias resolves to. All three name the same module, so all three
    // must be recognized as base — i.e. left alone rather than copied into the
    // install destination, which would leave `adoptsFrom` pointing at a module
    // that never gets written. (CS-12078)
    const baseRealmSpellings = {
      'canonical RRI prefix': `${baseRealmRRI}skill`,
      'symbolic cardstack.com alias': `${baseRealmURL}skill`,
      'real backing URL': `${resolvedBaseRealmURL}skill`,
    };
    for (let [spelling, module] of Object.entries(baseRealmSpellings)) {
      test(`instance adoptsFrom base realm is not copied — ${spelling}`, function (assert) {
        const instances = [
          {
            id: `${sourceRealmURL.href}some-folder/Example/1`,
            [meta]: {
              adoptsFrom: { name: 'Some Ref Name', module },
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
            new ListingPathResolver(
              targetRealmURL.href,
              listing,
              'xyz',
              virtualNetwork,
            ),
            virtualNetwork,
          );
        assert.deepEqual(modulesCopy, [], 'no base module is copied');
        assert.deepEqual(modulesToInstall, []);
        assert.strictEqual(instancesCopy.length, 1);
        assert.strictEqual(
          instancesCopy[0].lid,
          'some-listing-xyz/some-folder/Example/1',
        );
        // Canonical prefix form regardless of how it arrived: this ref is
        // written into the installed card's `meta.adoptsFrom`, so an
        // environment-specific URL would not be portable.
        assert.deepEqual(instancesCopy[0].targetCodeRef, {
          module: `${baseRealmRRI}skill`,
          name: 'Some Ref Name',
        });
      });
    }

    test('throws when the instance itself lives in the base realm, in any spelling', function (assert) {
      for (let id of [
        `${baseRealmRRI}Skill/example`,
        `${baseRealmURL}Skill/example`,
        `${resolvedBaseRealmURL}Skill/example`,
      ]) {
        const instances = [
          {
            id,
            [meta]: {
              adoptsFrom: {
                name: 'Skill',
                module: `${baseRealmRRI}skill`,
              },
            },
            [realmURL]: baseRealmURL,
          },
        ] as CardDef[];
        const listing = {
          name: 'Some Listing',
          specs: [],
          examples: instances,
          skills: [],
          [realmURL]: sourceRealmURL,
        } as any;
        assert.throws(
          () =>
            planInstanceInstall(
              instances,
              new ListingPathResolver(
                targetRealmURL.href,
                listing,
                'xyz',
                virtualNetwork,
              ),
              virtualNetwork,
            ),
          /Cannot install instance from base realm/,
          `rejects ${id}`,
        );
      }
    });
  });

  module('cross-realm support', function () {
    test('ListingPathResolver.local() strips foreign realm prefix when registered', function (assert) {
      const listing = {
        name: 'Some Listing',
        specs: [],
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let resolver = new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      );
      resolver.addKnownRealmURL(foreignRealmURL);

      // Same-realm URL resolves as before
      let sameRealmLocal = resolver.local(
        rri(`${sourceRealmURL.href}some-folder/Example/1`),
      );
      assert.strictEqual(sameRealmLocal, 'some-folder/Example/1');

      // Cross-realm URL with registered realm strips the foreign realm prefix
      let crossRealmLocal = resolver.local(
        rri(`${foreignRealmURL.href}CyclingMileageLog/abc`),
      );
      assert.strictEqual(crossRealmLocal, 'CyclingMileageLog/abc');
    });

    test('ListingPathResolver.local() falls back to full path for unregistered foreign realm', function (assert) {
      const listing = {
        name: 'Some Listing',
        specs: [],
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let resolver = new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      );

      let crossRealmLocal = resolver.local(
        rri(`${foreignRealmURL.href}CyclingMileageLog/abc`),
      );
      assert.strictEqual(
        crossRealmLocal,
        'user1/personal-realm/CyclingMileageLog/abc',
      );
    });

    test('ListingPathResolver.target() maps cross-realm URLs into target directory', function (assert) {
      const listing = {
        name: 'Some Listing',
        specs: [],
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let resolver = new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      );
      resolver.addKnownRealmURL(foreignRealmURL);

      let target = resolver.target(
        rri(`${foreignRealmURL.href}CyclingMileageLog/abc`),
      );
      assert.strictEqual(
        target,
        `${targetRealmURL.href}some-listing-xyz/CyclingMileageLog/abc`,
      );
    });

    test('planInstanceInstall handles instances from a foreign realm', function (assert) {
      const instances = [
        {
          id: `${foreignRealmURL.href}CyclingMileageLog/abc`,
          [meta]: {
            adoptsFrom: {
              name: 'CyclingMileageLog',
              module: `${foreignRealmURL.href}cycling-mileage-log`,
            },
          },
          [realmURL]: foreignRealmURL,
        },
      ] as CardDef[];
      const listing = {
        name: 'Some Listing',
        specs: [],
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let resolver = new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      );
      resolver.addKnownRealmURL(foreignRealmURL);
      let { instancesCopy, modulesCopy } = planInstanceInstall(
        instances,
        resolver,
        virtualNetwork,
      );

      assert.strictEqual(instancesCopy.length, 1);
      assert.strictEqual(
        instancesCopy[0].lid,
        'some-listing-xyz/CyclingMileageLog/abc',
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.strictEqual(
        modulesCopy[0].sourceCodeRef.module,
        `${foreignRealmURL.href}cycling-mileage-log`,
      );
    });

    test('planModuleInstall handles specs from a foreign realm', function (assert) {
      const specs = [
        {
          ref: {
            name: 'CyclingMileageLog',
            module: `${foreignRealmURL.href}cycling-mileage-log`,
          },
          moduleHref: `${foreignRealmURL.href}cycling-mileage-log`,
          [realmURL]: foreignRealmURL,
        },
      ] as Spec[];
      const listing = {
        name: 'Some Listing',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let resolver = new ListingPathResolver(
        targetRealmURL.href,
        listing,
        'xyz',
        virtualNetwork,
      );
      resolver.addKnownRealmURL(foreignRealmURL);
      let { modulesCopy, modulesToInstall } = planModuleInstall(
        specs,
        resolver,
        virtualNetwork,
      );

      assert.strictEqual(modulesCopy.length, 1);
      assert.deepEqual(modulesToInstall, [
        {
          sourceModule: `${foreignRealmURL.href}cycling-mileage-log`,
          targetModule: `${targetRealmURL.href}some-listing-xyz/cycling-mileage-log`,
        },
      ]);
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
      builder = new PlanBuilder(targetRealmURL.href, listing, virtualNetwork);
    });

    module('build()', function () {
      test('modulesCopy is deduplicated', function (assert) {
        builder.add(() => {
          return new InstallPlan(
            [
              {
                sourceCodeRef: {
                  name: 'Some Ref Name',
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                  name: 'Some Ref Name',
                },
                targetCodeRef: {
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                },
                targetCodeRef: {
                  name: 'Some Ref Name',
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                },
                targetCodeRef: {
                  name: 'Some Ref Name 2',
                  module: rri(`${targetRealmURL}xyz/some-folder/some`),
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
                  module: rri(`${sourceRealmURL.href}some-folder/some`),
                },
                targetCodeRef: {
                  name: 'Some Ref Name 3',
                  module: rri(`${targetRealmURL}xyz/some-folder/some-3`),
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
