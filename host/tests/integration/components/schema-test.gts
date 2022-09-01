import { module, test } from 'qunit';
import { TestContext } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';
import { ExportedCardRef } from '@cardstack/runtime-common';
import { setupRenderingTest } from 'ember-qunit';
import { renderComponent } from '../../helpers/render-component';
import Schema from 'runtime-spike/components/schema';
import { file, FileResource } from 'runtime-spike/resources/file';
import { ModuleSyntax } from '@cardstack/runtime-common/module-syntax';
import Service from '@ember/service';
import { waitUntil, click } from '@ember/test-helpers';
import { Loader } from '@cardstack/runtime-common/loader';
import { baseRealm } from '@cardstack/runtime-common';
import { RealmPaths } from '@cardstack/runtime-common/paths';
import { TestRealm, TestRealmAdapter, testRealmURL } from '../../helpers';
import { Realm } from "@cardstack/runtime-common/realm";
import "@cardstack/runtime-common/helpers/code-equality-assertion";

class MockLocalRealm extends Service {
  isAvailable = true;
  url = new URL(testRealmURL);
}

module('Integration | schema', function (hooks) {
  let realm: Realm;
  let adapter: TestRealmAdapter
  setupRenderingTest(hooks);

  hooks.beforeEach(async function() {
    Loader.destroy();
    Loader.addURLMapping(
      new URL(baseRealm.url),
      new URL('http://localhost:4201/base/')
    );
    Loader.disableNativeImport(true);
    adapter = new TestRealmAdapter({});
    realm = TestRealm.createWithAdapter(adapter);
    Loader.addRealmFetchOverride(realm);
    await realm.ready;
    this.owner.register('service:local-realm', MockLocalRealm);
  })

  test('renders card schema view', async function (assert) {
    await realm.write('person.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `);
    let { ref, openFile, moduleSyntax } = await getSchemaArgs(this, adapter, { module: `${testRealmURL}person`, name: 'Person'});
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{ref}} @file={{openFile}} @moduleSyntax={{moduleSyntax}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));

    assert.dom('[data-test-card-id]').hasText(`Card ID: ${testRealmURL}person/Person`);
    assert.dom('[data-test-adopts-from').hasText('Adopts From: https://cardstack.com/base/card-api/Card');
    assert.dom('[data-test-field="firstName"]').hasText('Delete firstName - contains - field card ID: https://cardstack.com/base/string/default');
  });

  test('renders link to field card for contained field', async function(assert) {
    await realm.write('person.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `);
    await realm.write('post.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class Post extends Card {
        @field title = contains(StringCard);
        @field author = contains(Person);
      }
    `);
    let { ref, openFile, moduleSyntax } = await getSchemaArgs(this, adapter, { module: `${testRealmURL}post`, name: 'Post'});
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{ref}} @file={{openFile}} @moduleSyntax={{moduleSyntax}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));
    assert.dom('[data-test-field="author"] a[href="/?path=person"]').exists('link to person card exists');
    assert.dom('[data-test-field="title"]').exists('the title field exists')
    assert.dom('[data-test-field="title"] a').doesNotExist('the title field has no link');
  });

  test('can delete a field from card', async function(assert){ 
    await realm.write('person.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `);
    let { ref, openFile, moduleSyntax } = await getSchemaArgs(this, adapter, { module: `${testRealmURL}person`, name: 'Person'});
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{ref}} @file={{openFile}} @moduleSyntax={{moduleSyntax}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));
    await click('[data-test-field="firstName"] button[data-test-delete]');
    let fileRef = await adapter.openFile('person.gts');
    let src = fileRef?.content as string;
    assert.codeEqual(src, `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field lastName = contains(StringCard);
      }
    `)
  });

  test('does not include a delete button for fields that are inherited', async function (assert) {
    await realm.write('person.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";

      export class Person extends Card {
        @field firstName = contains(StringCard);
        @field lastName = contains(StringCard);
      }
    `);
    await realm.write('fancy-person.gts', `
      import { contains, field, Card } from "https://cardstack.com/base/card-api";
      import StringCard from "https://cardstack.com/base/string";
      import { Person } from "./person";

      export class FancyPerson extends Person {
        @field favoriteColor = contains(StringCard);
      }
    `);
    let { ref, openFile, moduleSyntax } = await getSchemaArgs(this, adapter, { module: `${testRealmURL}fancy-person`, name: 'FancyPerson'});
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <Schema @ref={{ref}} @file={{openFile}} @moduleSyntax={{moduleSyntax}} />
        </template>
      }
    );

    await waitUntil(() => Boolean(document.querySelector('[data-test-card-id]')));
    assert.dom('[data-test-field="firstName"]').exists('firstName field exists');
    assert.dom('[data-test-field="firstName"] button[data-test-delete]').doesNotExist('delete button does not exist');
    assert.dom('[data-test-field="favoriteColor"] button[data-test-delete]').exists('delete button exists');
  });
});


async function getSchemaArgs(context: TestContext, adapter: TestRealmAdapter, ref: ExportedCardRef): Promise<{
  openFile: FileResource;
  moduleSyntax: ModuleSyntax;
  ref: ExportedCardRef;
}> {
  let fileURL = ref.module.endsWith('.gts') ? ref.module : `${ref.module}.gts`;
  let paths = new RealmPaths(testRealmURL);
  let content = (await adapter.openFile(paths.local(new URL(fileURL))))?.content as string | undefined;
  let openFile = file(context, () => ({
    url: fileURL,
    lastModified: undefined,
    content
  }));
  await openFile.loading;
  if (openFile.state !== "ready") {
    throw new Error(`could not open file ${openFile.url}`);
  }
  let moduleSyntax = new ModuleSyntax(openFile.content);
  return { moduleSyntax, ref, openFile };
}