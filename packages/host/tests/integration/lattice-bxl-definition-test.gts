import { bxl } from '@cardstack/bxl';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { getImmediateFieldDef } from '@cardstack/runtime-common';
import { getLatticeFieldDefinitions } from '@cardstack/runtime-common/lattice-compute-definitions';

import {
  setupBaseRealm,
  CardDef,
  contains,
  field,
  NumberField,
  linksToMany,
} from '../helpers/base-realm';
import { setupRenderingTest } from '../helpers/setup';

import type * as JsonFieldModule from '@cardstack/base/json-field';

module('Integration | Lattice computation definitions', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('captures declared data projections without treating them as executable code', async function (assert) {
    const api = await getService('card-service').getAPI();
    class InputRecord extends CardDef {
      @field amount = contains(NumberField);
    }
    class Dashboard extends CardDef {
      static materialized = true;
      static queryInputs = {
        records: { links: { person: { many: false, projection: {} } } },
      };
      @field records = linksToMany(() => InputRecord, {
        query: { page: { size: 20 } },
      });
    }
    getService('loader-service').loader.shimModule(
      'https://example.com/lattice-projection-test',
      { InputRecord, Dashboard },
    );
    const captured = getLatticeFieldDefinitions(api, Dashboard);
    assert.true(captured.nativeIndex?.materialized);
    assert.deepEqual(captured.nativeQueryInputs, Dashboard.queryInputs);
    assert.deepEqual(getImmediateFieldDef(captured, 'records')?.query, {
      page: { size: 20 },
    });
    captured.nativeQueryInputs!.records.links!.person.many = true;
    assert.false(
      Dashboard.queryInputs.records.links.person.many,
      'metadata consumers cannot mutate the definition declaration',
    );
  });

  test('captures genuine BXL, inherited trusted base code and arbitrary JS distinctly', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Totals extends CardDef {
      static displayName = 'Totals';
      @field amount = contains(NumberField);
      @field doubled = contains(NumberField, {
        computeVia: bxl('Amount * 2', { libraries: ['core'] }),
      });
      @field arbitrary = contains(NumberField, {
        computeVia: function (this: Totals) {
          return this.amount + 1;
        },
      });
    }
    const definitions = getLatticeFieldDefinitions(api, Totals);
    const captured = JSON.parse(JSON.stringify(definitions));
    assert.strictEqual(
      getImmediateFieldDef(captured, 'doubled')?.bxl?.expression,
      '.amount * 2',
    );
    assert.deepEqual(
      getImmediateFieldDef(captured, 'doubled')?.bxl?.libraries,
      ['core'],
    );
    assert.strictEqual(
      getImmediateFieldDef(captured, 'cardTitle')?.baseCompute,
      'cardTitle',
    );
    assert.strictEqual(
      getImmediateFieldDef(captured, 'cardTheme')?.baseCompute,
      'cardTheme',
    );
    assert.deepEqual(getImmediateFieldDef(captured, 'amount')?.nativeCodec, {
      kind: 'primitive',
      serializer: 'number',
    });
    assert.deepEqual(captured.nativeCodec, {
      kind: 'compound',
      resourceType: 'card',
    });
    const baseIndex = getLatticeFieldDefinitions(api, api.CardDef).nativeIndex!;
    assert.deepEqual(
      baseIndex.types.map((ref) => ('name' in ref ? ref.name : undefined)),
      ['CardDef', 'BaseDef'],
    );
    assert.deepEqual(baseIndex.displayNames, ['Card']);
    assert.strictEqual(baseIndex.cardType, 'CardDef');
    assert.strictEqual(
      getLatticeFieldDefinitions(api, api.StringField).nativeIndex,
      undefined,
    );
    assert.true(getImmediateFieldDef(captured, 'arbitrary')!.isComputed);
    assert.strictEqual(
      getImmediateFieldDef(captured, 'arbitrary')?.bxl,
      undefined,
    );
    assert.strictEqual(
      getImmediateFieldDef(captured, 'arbitrary')?.baseCompute,
      undefined,
    );
    const card = new Totals({ amount: 7 });
    assert.strictEqual(card.doubled, 14);
    assert.strictEqual(card.cardTitle, 'Untitled Totals');
    card.cardInfo.name = ' Named totals ';
    card.cardInfo.summary = 'Summary';
    card.cardInfo.cardThumbnailURL = 'authored.png';
    assert.strictEqual(card.cardTitle, ' Named totals ');
    assert.strictEqual(card.cardDescription, 'Summary');
    assert.strictEqual(card.cardThumbnailURL, 'authored.png');
  });

  test('an override with a base field name does not inherit base execution authority', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Renamed extends CardDef {
      @field cardTitle = contains(api.StringField, {
        computeVia: () => 'Application-defined title',
      });
    }
    const definitions = getLatticeFieldDefinitions(api, Renamed);
    assert.strictEqual(
      getImmediateFieldDef(definitions, 'cardTitle')?.baseCompute,
      undefined,
    );
    assert.strictEqual(
      getImmediateFieldDef(definitions, 'cardDescription')?.baseCompute,
      'cardDescription',
    );
  });

  test('captures standard inherited value hooks but declines custom search hooks and dynamic defaults', async function (assert) {
    const api = await getService('card-service').getAPI();
    class Ordinary extends api.StringField {}
    class Hidden extends api.StringField {
      static [api.queryableValue]() {
        return null;
      }
    }
    class Dynamic extends api.StringField {
      static get [api.emptyValue](): never {
        throw new Error('A native default must not invoke this getter');
      }
    }
    class Values extends CardDef {
      @field ordinary = contains(Ordinary);
      @field hidden = contains(Hidden);
      @field dynamic = contains(Dynamic);
    }
    const captured = JSON.parse(
      JSON.stringify(getLatticeFieldDefinitions(api, Values)),
    );
    assert.deepEqual(getImmediateFieldDef(captured, 'ordinary')?.nativeCodec, {
      kind: 'primitive',
      scalar: 'string',
    });
    assert.strictEqual(
      getImmediateFieldDef(captured, 'hidden')?.nativeCodec,
      undefined,
    );
    assert.strictEqual(
      getImmediateFieldDef(captured, 'dynamic')?.nativeCodec,
      undefined,
    );
  });

  test('captures the real base JSON field codec and preserves its search exclusion', async function (assert) {
    const api = await getService('card-service').getAPI();
    const { JsonField } = await getService('loader-service').loader.import<
      typeof JsonFieldModule
    >('@cardstack/base/json-field');
    class CustomJson extends JsonField {
      static [api.queryableValue]() {
        return null;
      }
    }
    class JsonValues extends CardDef {
      @field identity = contains(JsonField);
      @field derived = contains(JsonField, {
        computeVia: bxl(
          '{roster: .identity.roster, count: (.identity.roster | length)}',
          { readableSyntax: false, libraries: ['core'] },
        ),
      });
      @field custom = contains(CustomJson);
    }
    getService('loader-service').loader.shimModule(
      'https://example.com/lattice-json-field-test',
      { JsonValues, CustomJson },
    );
    const definitions = JSON.parse(
      JSON.stringify(getLatticeFieldDefinitions(api, JsonValues)),
    );
    assert.deepEqual(
      getImmediateFieldDef(definitions, 'identity')?.nativeCodec,
      { kind: 'json' },
    );
    assert.deepEqual(
      getImmediateFieldDef(definitions, 'derived')?.nativeCodec,
      { kind: 'json' },
    );
    assert.strictEqual(
      getImmediateFieldDef(definitions, 'custom')?.nativeCodec,
      undefined,
      'an arbitrary hook returning null does not acquire the base codec',
    );
    const value = new JsonValues({ identity: { roster: ['Avery', 'Riley'] } });
    const resource = JsonValues[api.serialize](
      value,
      { data: { type: 'card' } },
      new Set(),
      { includeComputeds: true },
    );
    assert.deepEqual(resource.attributes?.derived, {
      roster: ['Avery', 'Riley'],
      count: 2,
    });
    assert.strictEqual(
      JsonField[api.queryableValue]({ example: true }, []),
      null,
    );
  });
});
