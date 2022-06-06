import { module, test, skip } from 'qunit';
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
        if (specifier === './person') {
          return {
            Person
          }
        }
        return (window as any).RUNTIME_SPIKE_EXTERNALS.get(specifier);
      },
      currentPath: '/'
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
            @path="/"
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
            @path="/"
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
            @path="/"
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
            @path="/"
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
            @path="/"
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
            @path="/"
          />
        </template>
      }
    )

    await click('[data-test-create-card]');
    await click('[data-test-cancel-create]')
    assert.dom('[data-test-field="firstName"] input').doesNotExist();
    assert.dom('[data-test-field="lastName"] input').doesNotExist();
  });

  test('Can render field that uses base field card', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{singleCardModule}}
            @src={{singleCardSrc}}
            @inspector={{inspector}}
            @path="/"
          />
        </template>
      }
    );

    assert.dom('[data-test-field="firstName"]').containsText('firstName: contains runtime-spike/lib/string card');
    assert.dom('[data-test-field="firstName"] a').doesNotExist();
    assert.dom('[data-test-field="lastName"]').containsText('lastName: contains runtime-spike/lib/string card');
    assert.dom('[data-test-field="lastName"] a').doesNotExist();
  });

  test('Can render field that uses a user defined external card', async function (assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{usesExternalCardModule}}
            @src={{usesExternalCardSrc}}
            @inspector={{inspector}}
            @path="/"
          />
        </template>
      }
    );
    assert.dom('[data-test-field="author"]').containsText("author: contains 'Person' card of ./person");
    assert.dom('[data-test-field="author"] a[href="/?path=person"').containsText("'Person' card of ./person");
  });

  test('Can render field that uses card internal to the module', async function(assert) {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <SchemaInspector
            @module={{multipleCardsModule}}
            @src={{multipleCardsSrc}}
            @inspector={{inspector}}
            @path="/"
          />
        </template>
      }
    )

    await click('.card-button[data-test-card-name="Post"]');
    assert.dom('[data-test-field="author"]').containsText("author: contains 'Person' card");
  });

  skip('Can render field that uses contains-many field');
  skip('Can render field that uses computed field');
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
    static isolated = class Isolated extends Component<typeof this> {
      <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
    }
  }
`;
class Human extends Card {
  @field firstName = contains(StringCard);
  @field lastName = contains(StringCard);
  static isolated = class Isolated extends Component<typeof this> {
    <template><h1><@fields.firstName/> <@fields.lastName /></h1></template>
  }
}
const singleCardModule = { Human };

const usesExternalCardSrc = `
  import { contains, field, Component, Card } from 'runtime-spike/lib/card-api';
  import StringCard from 'runtime-spike/lib/string';
  import { Person } from './person';

  export class BlogPost extends Card {
    @field author = contains(Person);
    @field title = contains(StringCard);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <h1><@fields.title/></h1>
        <h3>by <@fields.author/></h3>
      </template>
    }
  }
`;
class BlogPost extends Card {
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
}
const usesExternalCardModule = {
  BlogPost
};

const noCardsSrc = `
  export const noCards = 'nothing to see here';
  export class NotACard { };
`;
class NotACard {}
const noCardsModule = {
  noCards: 'nothing to see here',
  NotACard
};