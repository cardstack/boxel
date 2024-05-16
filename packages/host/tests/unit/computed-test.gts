import { RenderingTestContext } from '@ember/test-helpers';

import { setupRenderingTest } from 'ember-qunit';
import { module, skip } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type LoaderService from '@cardstack/host/services/loader-service';

import { setupCardLogs } from '../helpers';

let cardApi: typeof import('https://cardstack.com/base/card-api');
let string: typeof import('https://cardstack.com/base/string');
let number: typeof import('https://cardstack.com/base/number');

let loader: Loader;

module('Unit | computeds', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = (this.owner.lookup('service:loader-service') as LoaderService)
      .loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    cardApi = await loader.import(`${baseRealm.url}card-api`);
    string = await loader.import(`${baseRealm.url}string`);
    number = await loader.import(`${baseRealm.url}number`);
  });

  skip('can calculate a synchronous computed field based on exclusive primitive', async function (assert) {
    let { field, contains, CardDef } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field lastName = contains(StringField);
      @field fullName = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName.value} ${this.lastName.value}`;
        },
      });
    }

    let mango = new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' });
    assert.strictEqual(mango.fullName.value, 'Mango Abdel-Rahman');
    mango.lastName = new StringField({ value: 'Tango' });
    await cardApi.recompute(mango, { recomputeAllFields: true });
    assert.strictEqual(mango.fullName.value, 'Mango Tango');
    mango.lastName.value = 'Django';
    await cardApi.recompute(mango, { recomputeAllFields: true });
    assert.strictEqual(mango.fullName.value, 'Mango Django');
  });

  skip('can calculate a synchronous computed field based on non-exclusive primitive', async function (assert) {
    let { field, contains, newPrimitive, CardDef } = cardApi;
    let { default: StringField } = string;
    class Person extends CardDef {
      @newPrimitive firstName: string | undefined;
      @newPrimitive lastName: string | undefined;
      @field fullName = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName} ${this.lastName}`;
        },
      });
    }

    let mango = new Person({ firstName: 'Mango', lastName: 'Abdel-Rahman' });
    assert.strictEqual(mango.fullName.value, 'Mango Abdel-Rahman');
    mango.lastName = 'Tango';
    await cardApi.recompute(mango, { recomputeAllFields: true });
    assert.strictEqual(mango.fullName.value, 'Mango Tango');
  });

  skip('can calculate a synchronous computed field based on legacy primitive', async function (assert) {
    let { field, contains, CardDef, FieldDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class UniformField extends FieldDef {
      @field number = contains(NumberField);
    }

    class Person extends CardDef {
      @field firstName = contains(StringField);
      @field uniform = contains(UniformField);
      @field playerId = contains(StringField, {
        computeVia: function (this: Person) {
          return `${this.firstName.value} ${this.uniform.number}`;
        },
      });
    }

    let mango = new Person({
      firstName: 'Mango',
      uniform: new UniformField({ number: 22 }),
    });
    assert.strictEqual(mango.playerId.value, 'Mango 22');
    mango.uniform.number = 33;
    await cardApi.recompute(mango, { recomputeAllFields: true });
    assert.strictEqual(mango.playerId.value, 'Mango 33');
  });
});
