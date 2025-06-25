import { module, test } from 'qunit';

import {
  PlanBuilder,
  planModuleInstall,
  planInstanceInstall,
  realmURL,
  InstallOptions,
  meta,
} from '@cardstack/runtime-common';

import type { CardDef } from 'https://cardstack.com/base/card-api';
import type { Spec } from 'https://cardstack.com/base/spec';

const sourceRealmURL = new URL('https://localhost:4201/catalog/');
const targetRealmURL = new URL('https://localhost:4201/experiments/');
const baseRealmURL = new URL('https://cardstack.com/base/');

module('Unit | Catalog | Install Plan Builder', function () {
  module('planModuleInstall()', function () {
    test('specs are in same organizing folder', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
        {
          ref: { name: 'Some Ref Name 2' },
          moduleHref: `${sourceRealmURL.href}some-folder/some-2`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const listing = {
        name: 'Some Folder',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const { modulesCopy } = planModuleInstall(
        specs,
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );

      assert.strictEqual(modulesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some.gts`,
        },
      });

      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name 2',
          module: `${sourceRealmURL.href}some-folder/some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name 2',
          module: `${targetRealmURL}some-folder-xyz/some-2.gts`,
        },
      });
    });

    test('listing name not provided & specs are in root of realm', function (assert) {
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );

      assert.strictEqual(modulesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some.gts`,
        },
      });
      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name 2',
          module: `${sourceRealmURL.href}some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name 2',
          module: `${targetRealmURL}xyz/some-2.gts`,
        },
      });
    });

    test('listing name not provided & specs are in same organizing folder', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
        {
          ref: { name: 'Some Ref Name 2' },
          moduleHref: `${sourceRealmURL.href}some-folder/some-2`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder/some.gts`,
        },
      });
      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name 2',
          module: `${sourceRealmURL.href}some-folder/some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name 2',
          module: `${targetRealmURL}xyz/some-folder/some-2.gts`,
        },
      });
    });

    test('listing name not provided & specs are in separate organizing folders', function (assert) {
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );

      assert.strictEqual(modulesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder/some.gts`,
        },
      });
      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name 2',
          module: `${sourceRealmURL.href}some-folder-2/some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name 2',
          module: `${targetRealmURL}xyz/some-folder-2/some-2.gts`,
        },
      });
    });

    test('specs are outside organizing folder', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-other-folder/some`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const listing = {
        name: 'Some Folder',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let { modulesCopy } = planModuleInstall(
        specs,
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-other-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some-other-folder/some.gts`,
        },
      });
    });
  });

  module('planInstanceInstall()', function () {
    test('instance adoptsFrom code in an organizing folder', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}some-folder/Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.strictEqual(instancesCopy.length, 1);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some.gts`,
        },
      });
      assert.strictEqual(instancesCopy[0].localDir, 'some-folder-xyz');
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-folder-xyz/some.gts`,
      });
    });
    test('listing name not provided & instance adoptsFrom code in an organizing folder', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}some-folder/Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.strictEqual(instancesCopy.length, 1);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder/some.gts`,
        },
      });

      assert.strictEqual(instancesCopy[0].localDir, 'xyz');
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}xyz/some-folder/some.gts`,
      });
    });
    test('listing name not provided & instance adoptsFrom code inside root of realm', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.strictEqual(instancesCopy.length, 1);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some.gts`,
        },
      });
      assert.strictEqual(instancesCopy[0].localDir, `xyz`);
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}xyz/some.gts`,
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
        name: 'Some Folder',
        specs: [],
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      let { modulesCopy, instancesCopy } = planInstanceInstall(
        instances,
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 0);
      assert.strictEqual(instancesCopy[0].localDir, 'some-folder-xyz');
      assert.strictEqual(instancesCopy[0].targetCodeRef, undefined);
    });
    test('listing name is not provided & instance adoptsFrom code that is outside of organizing folder', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder/some.gts`,
        },
      });
      assert.strictEqual(instancesCopy[0].localDir, `xyz`);
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}xyz/some-folder/some.gts`,
      });
    });

    test('instance adoptsFrom code outside of organizing folder', function (assert) {
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 1);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder-2/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some-folder-2/some.gts`,
        },
      });
      assert.strictEqual(instancesCopy[0].localDir, `some-folder-xyz`);
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-folder-xyz/some-folder-2/some.gts`,
      });
    });

    test('more than one instances adoptsFrom code in separate organizing folder', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}some-folder/Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
            },
          },
          [realmURL]: sourceRealmURL,
        },
        {
          id: `${sourceRealmURL.href}some-folder/Example/2`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder-2/some-2`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 2);
      assert.strictEqual(instancesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some-folder/some.gts`,
        },
      });
      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder-2/some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}some-folder-xyz/some-folder-2/some-2.gts`,
        },
      });
      assert.deepEqual(instancesCopy[0].localDir, 'some-folder-xyz');
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-folder-xyz/some-folder/some.gts`,
      });
      assert.deepEqual(instancesCopy[1].localDir, 'some-folder-xyz');
      assert.deepEqual(instancesCopy[1].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}some-folder-xyz/some-folder-2/some-2.gts`,
      });
    });

    test('no listing name provided & instance adoptsFrom code in separate organizing folder', function (assert) {
      const instances = [
        {
          id: `${sourceRealmURL.href}some-folder/Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
            },
          },
          [realmURL]: sourceRealmURL,
        },
        {
          id: `${sourceRealmURL.href}some-folder/Example/2`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder-2/some-2`,
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
        new InstallOptions(targetRealmURL.href, listing, 'xyz'),
      );
      assert.strictEqual(modulesCopy.length, 2);
      assert.strictEqual(instancesCopy.length, 2);
      assert.deepEqual(modulesCopy[0], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder/some`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder/some.gts`,
        },
      });
      assert.deepEqual(modulesCopy[1], {
        sourceCodeRef: {
          name: 'Some Ref Name',
          module: `${sourceRealmURL.href}some-folder-2/some-2`,
        },
        targetCodeRef: {
          name: 'Some Ref Name',
          module: `${targetRealmURL}xyz/some-folder-2/some-2.gts`,
        },
      });
      assert.deepEqual(instancesCopy[0].localDir, 'xyz');
      assert.deepEqual(instancesCopy[0].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}xyz/some-folder/some.gts`,
      });
      assert.deepEqual(instancesCopy[1].localDir, 'xyz');
      assert.deepEqual(instancesCopy[1].targetCodeRef, {
        name: 'Some Ref Name',
        module: `${targetRealmURL}xyz/some-folder-2/some-2.gts`,
      });
    });
  });
  module('InstallOptions()', function () {
    test('listing name derives source directory', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const listing = {
        name: 'Some Folder',
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const opts = new InstallOptions(targetRealmURL.href, listing, 'xyz');
      assert.strictEqual(
        opts.sourceDirectory,
        `${sourceRealmURL.href}some-folder/`,
      );
      assert.strictEqual(
        opts.targetDirectory,
        `${targetRealmURL.href}some-folder-xyz/`,
      );
    });

    test('when no listing name is provided, source directory defaults to source realm', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const listing = {
        specs,
        examples: [],
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const opts = new InstallOptions(targetRealmURL.href, listing, 'xyz');
      assert.strictEqual(opts.sourceDirectory, sourceRealmURL.href);
      assert.strictEqual(opts.targetDirectory, `${targetRealmURL.href}xyz/`);
    });

    test('instance exist in different organizing directory as code but adoptsFrom code from organizing directory', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const instances = [
        {
          id: `${sourceRealmURL.href}Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-folder/some`,
            },
          },
          [realmURL]: sourceRealmURL,
        },
      ];
      const listing = {
        name: 'Some Folder',
        specs,
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const opts = new InstallOptions(targetRealmURL.href, listing, 'xyz');
      assert.strictEqual(
        opts.sourceDirectory,
        `${sourceRealmURL.href}some-folder/`,
      );
      assert.strictEqual(
        opts.targetDirectory,
        `${targetRealmURL.href}some-folder-xyz/`,
      );
    });

    test('instance exist inside organizing directory as code but adoptsFrom from code outside organizing directory', function (assert) {
      const specs = [
        {
          ref: { name: 'Some Ref Name' },
          moduleHref: `${sourceRealmURL.href}some-folder/some`,
          [realmURL]: sourceRealmURL,
        },
      ] as Spec[];
      const instances = [
        {
          id: `${sourceRealmURL.href}some-folder/Example/1`,
          [meta]: {
            adoptsFrom: {
              name: 'Some Ref Name',
              module: `${sourceRealmURL.href}some-other-folder/some`,
            },
          },
          [realmURL]: sourceRealmURL,
        },
      ];
      const listing = {
        name: 'Some Folder',
        specs,
        examples: instances,
        skills: [],
        [realmURL]: sourceRealmURL,
      } as any;
      const opts = new InstallOptions(targetRealmURL.href, listing, 'xyz');
      assert.strictEqual(opts.sourceDirectory, `${sourceRealmURL.href}`);
      assert.strictEqual(
        opts.targetDirectory,
        `${targetRealmURL.href}some-folder-xyz/`,
      );
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
      const opts = new InstallOptions(targetRealmURL.href, listing, 'xyz');
      builder = new PlanBuilder(opts);
    });
    test('each modulesCopy is unique', function (assert) {
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
                module: `${targetRealmURL}xyz/some-folder/some.gts`,
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
                module: `${targetRealmURL}xyz/some-folder/some.gts`,
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
              module: `${targetRealmURL}xyz/some-folder/some.gts`,
              name: 'Some Ref Name',
            },
          },
        ],
      });
    });
    test('each instanceCopy is unique', function (assert) {
      builder.add(() => {
        return {
          modulesCopy: [],
          instancesCopy: [
            {
              sourceCard: {} as CardDef,
              localDir: `xyz/some-folder`,
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
              localDir: `xyz/some-folder`,
            },
          ],
        };
      });
      let plan = builder.build();
      assert.deepEqual(plan, {
        instancesCopy: [
          {
            sourceCard: {} as CardDef,
            localDir: `xyz/some-folder`,
          },
        ],
        modulesCopy: [],
      });
    });
  });
});
