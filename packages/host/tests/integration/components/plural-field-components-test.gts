import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import {
  field,
  contains,
  containsMany,
  linksToMany,
  Box,
  CardDef,
  Component,
  FieldDef,
  type BaseDef,
  type BoxComponent,
  type Field,
} from '@cardstack/base/card-api';
import { getContainsManyComponent } from '@cardstack/base/contains-many-component';
import { getLinksToManyComponent } from '@cardstack/base/links-to-many-component';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  getField,
  PermissionsContextName,
  type Permissions,
} from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { provideConsumeContext, setupCardLogs } from '../../helpers';
import { renderCard, renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module('Integration | plural field components', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    let permissions: Permissions = {
      canWrite: true,
      canRead: true,
    };
    provideConsumeContext(PermissionsContextName, permissions);

    loader = getService('loader-service').loader;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  test('iterating the field builds each row component once', async function (assert) {
    class Person extends CardDef {
      @field nicknames = containsMany(StringField);
    }
    let person = new Person({ nicknames: ['Mango', 'Van Gogh', 'Ringo'] });
    let model = Box.create(person) as unknown as Box<FieldDef>;
    let cardTypeForCalls = 0;
    let nicknames = getContainsManyComponent({
      model,
      arrayField: model.field('nicknames' as never) as Box<FieldDef[]>,
      field: getField(Person, 'nicknames') as Field<typeof FieldDef>,
      cardTypeFor(field: Field<typeof BaseDef>) {
        cardTypeForCalls++;
        return field.card;
      },
    }) as unknown as BoxComponent[];

    await renderComponent(
      <template>
        {{#each nicknames as |Nickname|}}
          <span data-test-nickname><Nickname @format='atom' /></span>
        {{/each}}
      </template>,
    );

    assert
      .dom('[data-test-nickname]')
      .exists({ count: 3 }, 'every row renders');
    assert.dom('[data-test-nickname]:nth-of-type(2)').hasText('Van Gogh');
    assert.strictEqual(
      cardTypeForCalls,
      3,
      'one iteration builds one component per row',
    );

    cardTypeForCalls = 0;
    person.nicknames.push('Paper');
    await settled();

    assert
      .dom('[data-test-nickname]')
      .exists({ count: 4 }, 'a row added to the field renders');
    assert.dom('[data-test-nickname]:nth-of-type(4)').hasText('Paper');
    assert.strictEqual(
      cardTypeForCalls,
      4,
      're-iterating after a change builds one component per row',
    );
  });

  test('iterating a linksToMany field builds each row component once', async function (assert) {
    class Pet extends CardDef {
      @field name = contains(StringField);
    }
    class Person extends CardDef {
      @field pets = linksToMany(Pet);
    }
    let person = new Person({
      pets: [
        new Pet({ name: 'Mango' }),
        new Pet({ name: 'Van Gogh' }),
        new Pet({ name: 'Ringo' }),
      ],
    });
    let model = Box.create(person) as Box<CardDef>;
    let cardTypeForCalls = 0;
    let pets = getLinksToManyComponent({
      model,
      arrayField: model.field('pets' as never) as Box<CardDef[]>,
      field: getField(Person, 'pets') as Field<typeof CardDef>,
      cardTypeFor(field: Field<typeof BaseDef>) {
        cardTypeForCalls++;
        return field.card;
      },
    }) as unknown as BoxComponent[];

    assert.strictEqual([...pets].length, 3, 'every row is iterated');
    assert.strictEqual(
      cardTypeForCalls,
      3,
      'one iteration builds one component per row',
    );
  });

  test('indexed reads and length build only what they return', async function (assert) {
    class Person extends CardDef {
      @field nicknames = containsMany(StringField);
    }
    let person = new Person({ nicknames: ['Mango', 'Van Gogh', 'Ringo'] });
    let model = Box.create(person) as unknown as Box<FieldDef>;
    let cardTypeForCalls = 0;
    let nicknames = getContainsManyComponent({
      model,
      arrayField: model.field('nicknames' as never) as Box<FieldDef[]>,
      field: getField(Person, 'nicknames') as Field<typeof FieldDef>,
      cardTypeFor(field: Field<typeof BaseDef>) {
        cardTypeForCalls++;
        return field.card;
      },
    }) as unknown as BoxComponent[];

    assert.strictEqual(nicknames.length, 3);
    assert.strictEqual(cardTypeForCalls, 0, 'length builds no component');

    assert.ok(nicknames[1], 'an indexed read returns that row component');
    assert.strictEqual(nicknames[3], undefined, 'a read past the end is empty');
    assert.strictEqual(
      cardTypeForCalls,
      1,
      'an indexed read builds only that row component',
    );
  });

  test('rendering a computed containsMany with {{#each}} evaluates it linearly in its row count', async function (assert) {
    let evaluations = 0;
    class Day extends FieldDef {
      @field index = contains(NumberField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-day><@fields.index /></span>
        </template>
      };
    }
    class Calendar extends CardDef {
      @field dayCount = contains(NumberField);
      @field days = containsMany(Day, {
        computeVia: function (this: Calendar) {
          evaluations++;
          return Array.from(
            { length: this.dayCount ?? 0 },
            (_, index) => new Day({ index }),
          );
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          {{#each @fields.days as |Day|}}
            <Day />
          {{/each}}
        </template>
      };
    }

    async function evaluationsToRender(dayCount: number) {
      evaluations = 0;
      await renderCard(loader, new Calendar({ dayCount }), 'isolated');
      assert
        .dom('[data-test-day]')
        .exists({ count: dayCount }, `all ${dayCount} days render`);
      return evaluations;
    }

    let forFour = await evaluationsToRender(4);
    let forSixteen = await evaluationsToRender(16);

    assert.ok(
      forSixteen <= forFour * 4,
      `4x the rows costs at most 4x the evaluations (4 rows: ${forFour}, 16 rows: ${forSixteen})`,
    );
  });
});
