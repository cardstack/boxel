import { module, test } from 'qunit';
import GlimmerComponent from '@glimmer/component';
import { CardRef, baseRealm } from '@cardstack/runtime-common';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import Schema from 'runtime-spike/components/schema';
import Service from '@ember/service';
import { waitUntil } from '@ember/test-helpers';

// TODO Consider making this a helper
class NodeRealm extends Service {
  isAvailable = true;
  url = new URL('http://localhost:4202/');
  realmMappings = new Map([
    [baseRealm.url, 'http://localhost:4201/base/'],
    ['http://test-realm/', 'http://localhost:4202/']
  ])
  mapURL(url: string, reverseLookup = false) {
    for (let [realm, forwardURL] of this.realmMappings) {
      if (!reverseLookup && url.startsWith(realm)) {
        return url.replace(realm, forwardURL);
      }
      if (reverseLookup && url.startsWith(forwardURL)) {
        return url.replace(forwardURL, realm);
      }
    }
    return url;
  }
}

module('Integration | schema', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function() {
    this.owner.register('service:local-realm', NodeRealm);
  })

  test('renders card schema view', async function (assert) {
    const args: CardRef =  { type: 'exportedCard', module: 'http://test-realm/person', name: 'Person' };
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{args}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));

    assert.dom('[data-test-card-id]').hasText('Card ID: http://test-realm/person/Person');
    assert.dom('[data-test-adopts-from').hasText('Adopts From: https://cardstack.com/base/card-api/Card');
    assert.dom('[data-test-field="firstName"]').hasText('firstName - contains - field card ID: https://cardstack.com/base/string/default');
    assert.dom('[data-test-create-card="Person"]').exists();
  });

  test('renders link to field card for contained field', async function(assert) {
    const args: CardRef =  { type: 'exportedCard', module: 'http://test-realm/post', name: 'Post' };
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
    assert.dom('[data-test-create-card="Post"]').exists();
  });
});
