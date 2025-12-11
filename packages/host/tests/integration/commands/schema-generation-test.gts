import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import {
  AttributesSchema,
  basicMappings,
} from '@cardstack/runtime-common/helpers/ai';

import { HostCommandClasses } from '@cardstack/host/commands';

import HostBaseCommand from '@cardstack/host/lib/host-base-command';

import * as CardAPI from 'https://cardstack.com/base/card-api';

import { setupSnapshotRealm } from '../../helpers';
import { setupRenderingTest } from '../../helpers/setup';

module(
  'Integration | Command | host command schema generation test',
  function (hooks) {
    let loader,
      mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
      cardAPI: typeof CardAPI;
    setupRenderingTest(hooks);
    setupWindowMock(hooks);
    let snapshot = setupSnapshotRealm(hooks, {
      mockMatrixUtils: undefined as any,
      async build({ loader }) {
        let loaderService = getService('loader-service');
        loaderService.loader = loader;
        mappings = await basicMappings(loader);
        cardAPI = await loader.import<typeof CardAPI>(
          `${baseRealm.url}card-api`,
        );
        await loader.import(`${baseRealm.url}command`);
        return { loader };
      },
    });

    module('command schema generation', function (hooks) {
      hooks.beforeEach(async function () {
        ({ loader } = snapshot.get());
      });
      // for each host command, attempt to generate a JSON schema with strict: true
      for (const CommandClass of HostCommandClasses) {
        test(
          'getInputJsonSchema for ' + CommandClass.name,
          async function (assert) {
            // Type CommandClass as a concrete subclass of BaseHostCommand
            const TypedCommandClass = CommandClass as unknown as new (
              ...args: any[]
            ) => HostBaseCommand<any, any>;
            let command = new TypedCommandClass(
              getService('command-service').commandContext,
            );
            const inputSchema = await command.getInputJsonSchema(
              cardAPI,
              mappings,
              true,
            );
            assert.ok(inputSchema, 'Input JSON schema is defined');
          },
        );
      }
    });
  },
);
