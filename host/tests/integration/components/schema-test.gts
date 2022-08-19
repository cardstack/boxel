import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { CardRef } from '@cardstack/runtime-common';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import Schema from 'runtime-spike/components/schema';
import Service from '@ember/service';
import { waitUntil } from '@ember/test-helpers';

const testRealmURL = 'http://localhost:4201/test/'

class NodeRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

module('Integration | schema', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function() {
    this.owner.register('service:local-realm', NodeRealm);
  })

  test('renders card schema view', async function (assert) {
    const args: CardRef =  { type: 'exportedCard', module: `${testRealmURL}person`, name: 'Person' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{args}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));

    assert.dom('[data-test-card-id]').hasText(`Card ID: ${testRealmURL}person/Person`);
    assert.dom('[data-test-adopts-from').hasText('Adopts From: https://cardstack.com/base/card-api/Card');
    assert.dom('[data-test-field="firstName"]').hasText('firstName - contains - field card ID: https://cardstack.com/base/string/default');
  });

  test('renders link to field card for contained field', async function(assert) {
    const args: CardRef =  { type: 'exportedCard', module: `${testRealmURL}post`, name: 'Post' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{args}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));
    assert.dom('[data-test-field="author"] a[href="/?path=person"]').exists('link to person card exists');
    assert.dom('[data-test-field="title"]').exists('the title field exists')
    assert.dom('[data-test-field="title"] a').doesNotExist('the title field has no link');
  });
});
