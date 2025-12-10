import { getService } from '@universal-ember/test-support';
import { setupWindowMock } from 'ember-window-mock/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { AttributesSchema } from '@cardstack/runtime-common/helpers/ai';
import { basicMappings } from '@cardstack/runtime-common/helpers/ai';

import { HostCommandClasses } from '@cardstack/host/commands';

import type HostBaseCommand from '@cardstack/host/lib/host-base-command';

import type * as CardAPI from 'https://cardstack.com/base/card-api';

import { setupRenderingTest } from '../../helpers/setup';

module(
  'Integration | Command | host command schema generation test',
  function (hooks) {
    setupRenderingTest(hooks);
    setupWindowMock(hooks);

    module('command schema generation', function (hooks) {
      let loader,
        mappings: Map<typeof CardAPI.FieldDef, AttributesSchema>,
        cardAPI: typeof CardAPI;
      hooks.beforeEach(async function () {
        loader = getService('loader-service').loader;
        mappings = await basicMappings(loader);
        cardAPI = await loader.import<typeof CardAPI>(
          `${baseRealm.url}card-api`,
        );
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
