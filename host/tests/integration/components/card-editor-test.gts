import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { click, fillIn } from '@ember/test-helpers';
import { setupRenderingTest } from 'ember-qunit';
import CardEditor, { ExistingCardArgs }  from 'runtime-spike/components/card-editor';
import { contains, field, Component, Card, Format } from 'runtime-spike/lib/card-api';
import StringCard from 'runtime-spike/lib/string';
import { renderComponent } from '../../helpers/render-component';

const formats: Format[] = ['isolated', 'embedded', 'edit'];
module('Integration | card-editor', function (hooks) {
  setupRenderingTest(hooks);

  test('renders card', async function (assert) {
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-firstName><@fields.firstName/></div> </template>
      }
    }
    let module = { default: TestCard };
    let json = {
      data: {
        type: 'card',
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: { module: '', name: 'default'} }
      }
    };
    const args: ExistingCardArgs = { type: 'existing', json, url: 'http://test-realm/card' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @module={{module}} @card={{args}} @formats={{formats}}/>
        </template>
      }
    )

    assert.dom('[data-test-firstName]').hasText('Mango');
  });

  test('can change card format', async function (assert) {
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-isolated-firstName><@fields.firstName/></div> </template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template> <div data-test-embedded-firstName><@fields.firstName/></div> </template>
      }
      static edit = class Edit extends Component<typeof this> {
        <template> <div data-test-edit-firstName><@fields.firstName/></div> </template>
      }
    }
    let module = { default: TestCard };
    let json = {
      data: {
        type: 'card',
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: { module: '', name: 'default'} }
      }
    };
    const args: ExistingCardArgs = { type: 'existing', json, url: 'http://test-realm/card' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @module={{module}} @card={{args}} @formats={{formats}}/>
        </template>
      }
    )

    assert.dom('[data-test-isolated-firstName]').hasText('Mango');
    assert.dom('[data-test-embedded-firstName]').doesNotExist();
    assert.dom('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.embedded')
    assert.dom('[data-test-isolated-firstName]').doesNotExist();
    assert.dom('[data-test-embedded-firstName]').hasText('Mango');
    assert.dom('[data-test-edit-firstName]').doesNotExist();

    await click('.format-button.edit')
    assert.dom('[data-test-isolated-firstName]').doesNotExist();
    assert.dom('[data-test-embedded-firstName]').doesNotExist();
    assert.dom('[data-test-edit-firstName] input').hasValue('Mango');
  });

  test('edited card data in visible in different formats', async function (assert) {
    class TestCard extends Card {
      @field firstName = contains(StringCard);
      static isolated = class Isolated extends Component<typeof this> {
        <template> <div data-test-isolated-firstName><@fields.firstName/></div> </template>
      }
      static embedded = class Embedded extends Component<typeof this> {
        <template> <div data-test-embedded-firstName><@fields.firstName/></div> </template>
      }
      static edit = class Edit extends Component<typeof this> {
        <template> <div data-test-edit-firstName><@fields.firstName/></div> </template>
      }
    }
    let module = { default: TestCard };
    let json = {
      data: {
        type: 'card',
        attributes: { firstName: 'Mango' },
        meta: { adoptsFrom: { module: '', name: 'default'} }
      }
    };
    const args: ExistingCardArgs = { type: 'existing', json, url: 'http://test-realm/card' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @module={{module}} @card={{args}} @formats={{formats}}/>
        </template>
      }
    )

    await click('.format-button.edit')
    await fillIn('[data-test-edit-firstName] input', 'Van Gogh');

    await click('.format-button.embedded');
    assert.dom('[data-test-embedded-firstName]').hasText('Van Gogh');

    await click('.format-button.isolated');
    assert.dom('[data-test-isolated-firstName]').hasText('Van Gogh');
  });

  test('can detect when card is dirty', async function(assert) {
    class Person extends Card {
      @field firstName = contains(StringCard);
      static embedded = class Embedded extends Component<typeof this> {
        <template><@fields.firstName /></template>
      }
    }

    class Post extends Card{
      @field title = contains(StringCard);
      @field author = contains(Person);
    }

    let module = { default: Post };
    let json = {
      data: {
        type: 'card',
        attributes: {
          author: {
            firstName: 'Mango'
          },
          title: 'We Need to Go to the Dog Park Now!'
        },
        meta: { adoptsFrom: { module: '', name: 'default'} }
      }
    };
    const args: ExistingCardArgs = { type: 'existing', json, url: 'http://test-realm/card' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <CardEditor @module={{module}} @card={{args}} @formats={{formats}}/>
        </template>
      }
    )

    await click('.format-button.edit')
    assert.dom('[data-test-save-card]').doesNotExist();
    assert.dom('[data-test-reset]').doesNotExist();

    await fillIn('[data-test-field="title"] input', 'Why I Whine'); // dirty top level field
    assert.dom('[data-test-field="title"] input').hasValue('Why I Whine');
    assert.dom('[data-test-save-card]').exists();
    assert.dom('[data-test-reset]').exists();

    await click('[data-test-reset]');
    assert.dom('[data-test-save-card]').doesNotExist();
    assert.dom('[data-test-reset]').doesNotExist();
    assert.dom('[data-test-field="title"] input').hasValue('We Need to Go to the Dog Park Now!');


    await fillIn('[data-test-field="firstName"] input', 'Van Gogh'); // dirty nested field
    assert.dom('[data-test-field="firstName"] input').hasValue('Van Gogh');
    assert.dom('[data-test-save-card]').exists();
    assert.dom('[data-test-reset]').exists();

    await click('[data-test-reset]');
    assert.dom('[data-test-save-card]').doesNotExist();
    assert.dom('[data-test-reset]').doesNotExist();
    assert.dom('[data-test-field="firstName"] input').hasValue('Mango');
  });
});