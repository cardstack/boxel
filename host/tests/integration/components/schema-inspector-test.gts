import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { click } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import SchemaInspector from 'runtime-spike/components/schema-inspector';
import { renderComponent } from '../../helpers/render-component';
import { cleanWhiteSpace } from '../../helpers';
import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import TextAreaCard from 'runtime-spike/lib/text-area';
import { CardInspector } from 'runtime-spike/lib/schema-util';

module('Integration | schema-inspector', function (hooks) {
  setupRenderingTest(hooks);

  let inspector: CardInspector;
  hooks.before(function () {
    inspector = new CardInspector({
      async resolveModule(specifier: string) {
        return (window as any).RUNTIME_SPIKE_EXTERNALS.get(specifier);
      },
    });
  });

  test('renders card chooser', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{multipleCardsModule}}
            @src={{multipleCardsSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').exists({ count: 2}, 'Found 2 cards');
    assert.dom('.selected-card').containsText('Person', 'the first card is selected by default');
  });

  test('clicking on a card button will select the card', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{multipleCardsModule}}
            @src={{multipleCardsSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    await click('.card-button[data-test-card-name="Post"]');
    assert.dom('.selected-card').containsText('Post');
  });

  test('when there is just one exported card no chooser is shown', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{singleCardModule}}
            @src={{singleCardSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').doesNotExist();
    assert.dom('.selected-card').containsText('Human');
  });

  test('when there are no cards in a module a message is displayed saying as much', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{noCardsModule}}
            @src={{noCardsSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    assert.dom('.card-chooser .card-button').doesNotExist();
    assert.dom('.selected-card').doesNotExist();
    assert.strictEqual(cleanWhiteSpace(this.element.textContent!), 'No cards found in this module');
  });

  test('clicking on create shows the card edit form', async function(assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{singleCardModule}}
            @src={{singleCardSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    await click('[data-test-create-card]');
    assert.dom('[data-test-field="firstName"] input').exists();
    assert.dom('[data-test-field="lastName"] input').exists();
  });

  test('clicking on cancel dismisses the card edit form', async function(assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{singleCardModule}}
            @src={{singleCardSrc}}
            @inspector={{inspector}}
          />
        </template>
      }
    )

    await click('[data-test-create-card]');
    await click('[data-test-cancel-create]')
    assert.dom('[data-test-field="firstName"] input').doesNotExist();
    assert.dom('[data-test-field="lastName"] input').doesNotExist();
  });
});


// UGH I don't have a good answer for this--we want both
// the card source and the evaluated card modules (which
// requires a babel build step). So we need to keep these
// sources and their corresponding modules in sync

const multipleCardsSrc = `
  import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
  import StringCard from 'runtime-spike/lib/string';
  import TextAreaCard from 'runtime-spike/lib/text-area';

  export class Person extends Card {
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    static embedded = class Embedded extends Component<typeof this> {
      <template><@fields.firstName/> <@fields.lastName /></template>
    }
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
    }
  }

  export class Post extends Card {
    @field author = contains(Person);
    @field title = contains(StringCard);
    @field body = contains(TextAreaCard);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <h1><@fields.title/></h1>
        <h3>by <@fields.author/></h3>
        <p><@fields.body/></p>
      </template>
    }
    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <em><@fields.title/></em> by <@fields.author/>
      </template>
    }
  }

  export const notACard = "I'm not a card";
  export const alsoNotACard = { notACard: true };
`;
class Person extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.firstName/> <@fields.lastName /></template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
  }
}
class Post extends Card {
  @field author = contains(Person);
  @field title = contains(StringCard);
  @field body = contains(TextAreaCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1><@fields.title/></h1>
      <h3>by <@fields.author/></h3>
      <p><@fields.body/></p>
    </template>
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <em><@fields.title/></em> by <@fields.author/>
    </template>
  }
}
const multipleCardsModule = {
  Person,
  Post,
  notACard: "I'm not a card",
  alsoNotACard: { notACard: true },
};

const singleCardSrc = `
  import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
  import StringCard from 'runtime-spike/lib/string';

  export class Human extends Card {
    @field firstName = contains(StringCard);
    @field lastName = contains(StringCard);
    static embedded = class Embedded extends Component<typeof this> {
      <template><@fields.firstName/> <@fields.lastName /></template>
    }
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
    }
  }
`;
class Human extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static embedded = class Embedded extends Component<typeof this> {
    <template><@fields.firstName/> <@fields.lastName /></template>
  }
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
  }
}
const singleCardModule = { Human };

const noCardsSrc = `
  export const noCards = 'nothing to see here';
  export class NotACard { };
`;
class NotACard {}
const noCardsModule = {
  noCards: 'nothing to see here',
  NotACard
};