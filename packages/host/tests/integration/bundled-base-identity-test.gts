import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Loader, getField, identifyCard } from '@cardstack/runtime-common';
import type { RealmResourceIdentifier } from '@cardstack/runtime-common';

import { tagTestModuleExports } from '../helpers/identity-tags';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPIModule from '@cardstack/base/card-api';

// A pair of modules standing in for two bundled base modules: `declarer`
// declares a FieldDef, and `holder` holds it as a field. The holder names the
// class by JS reference rather than by asking the loader for it, which is what
// bundling leaves behind — the bundler resolves a bundled module's import
// inside the chunk, so the loader is never asked for the declarer. Each class
// is tagged with its identity where it is defined, as compiling the module
// tags it, whether or not the loader is ever asked for the module.
const DECLARER =
  'http://bundled-identity.test/declarer' as RealmResourceIdentifier;
const HOLDER = 'http://bundled-identity.test/holder' as RealmResourceIdentifier;

// The same shape with a link in place of the contained field, built fresh per
// call so each case gets classes no earlier one has named.
let linkPairs = 0;
function defineLinkedPair(api: typeof CardAPIModule) {
  let { CardDef, field, linksTo } = api;
  let n = linkPairs++;
  let declarer =
    `http://bundled-identity.test/link-declarer-${n}` as RealmResourceIdentifier;
  let holder =
    `http://bundled-identity.test/link-holder-${n}` as RealmResourceIdentifier;

  class Target extends CardDef {
    static displayName = 'Target';
  }
  class LinkHolder extends CardDef {
    static displayName = 'LinkHolder';
    @field target = linksTo(Target);
  }

  tagTestModuleExports(declarer, { Target });
  tagTestModuleExports(holder, { LinkHolder });
  let virtualNetwork = getService('network').virtualNetwork;
  virtualNetwork.shimAsyncModule({
    id: declarer,
    resolve: async () => ({ Target }),
  });
  virtualNetwork.shimAsyncModule({
    id: holder,
    resolve: async () => ({ LinkHolder }),
  });
  return { Target, LinkHolder, declarer, holder };
}

function defineBundledPair(api: typeof CardAPIModule) {
  let { CardDef, Component, FieldDef, contains, field } = api;

  class Detail extends FieldDef {
    static displayName = 'Detail';
    @field note = contains(api.CSSField);
    static embedded = class Embedded extends Component<typeof this> {
      <template>
        <span data-test-detail-note>{{@model.note}}</span>
      </template>
    };
  }

  class Holder extends CardDef {
    static displayName = 'Holder';
    @field detail = contains(Detail);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-holder><@fields.detail /></div>
      </template>
    };
  }

  // Each module exposes only what it declares, as a compiled module does. The
  // holder does not re-export `Detail`, so serving the holder says nothing
  // about where `Detail` comes from.
  tagTestModuleExports(DECLARER, { Detail });
  tagTestModuleExports(HOLDER, { Holder });
  let virtualNetwork = getService('network').virtualNetwork;
  virtualNetwork.shimAsyncModule({
    id: DECLARER,
    resolve: async () => ({ Detail }),
  });
  virtualNetwork.shimAsyncModule({
    id: HOLDER,
    resolve: async () => ({ Holder }),
  });
  return { Detail, Holder };
}

function holderDoc() {
  let resource = {
    attributes: { detail: { note: 'a note' } },
    meta: { adoptsFrom: { module: HOLDER, name: 'Holder' } },
  };
  return { resource, doc: { data: resource } };
}

module('Integration | bundled base identity', function (hooks) {
  setupRenderingTest(hooks);

  async function cardAPI() {
    let loader = getService('loader-service').loader;
    return await loader.import<typeof CardAPIModule>(
      '@cardstack/base/card-api',
    );
  }

  // A class's identity is compiled into it, so a class held as a field is
  // named by the module that declares it even though the loader is never
  // asked for that module.
  test('a class only a bundled sibling names is identified by its declaring module', async function (assert) {
    let loader = getService('loader-service').loader;
    let { Detail, Holder } = defineBundledPair(await cardAPI());

    await loader.import(HOLDER);

    assert.deepEqual(
      Loader.identify(Holder),
      { module: HOLDER, name: 'Holder' },
      'the module the loader was asked for names its own class',
    );
    assert.deepEqual(
      identifyCard(Detail),
      { module: DECLARER, name: 'Detail' },
      'the field class is named by the module that declares it',
    );
    assert.strictEqual(
      getField(Holder, 'detail')!.card,
      Detail,
      'resolving the field reaches the same class',
    );
  });

  // What that identity is for: deserializing a compound field asks for one, and
  // fails without it. The holder's own identity carries the field.
  test('a card holding such a field deserializes and renders', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await cardAPI();
    defineBundledPair(api);
    let { resource, doc } = holderDoc();

    let card = await api.createFromSerialized(
      resource as any,
      doc as any,
      undefined,
    );
    await renderCard(loader, card as any, 'isolated');
    assert.dom('[data-test-holder] [data-test-detail-note]').hasText('a note');

    assert.deepEqual(
      api.serializeCard(card as any, {}).data.meta,
      { adoptsFrom: { module: HOLDER, name: 'Holder' } },
      'the round trip records the holder and nothing about the field',
    );
  });

  // A link carries its type as data — the chooser searches by it — so the
  // type has to be named the same way whichever modules were served: by the
  // module that declares it.
  test('a link to such a class names its declaring module whichever modules were served', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await cardAPI();

    let unserved = defineLinkedPair(api);
    await loader.import(unserved.holder);
    assert.deepEqual(
      identifyCard(getField(unserved.LinkHolder, 'target')!.card),
      { module: unserved.declarer, name: 'Target' },
      'the link target is named by its module though that module was never asked for',
    );

    let served = defineLinkedPair(api);
    await loader.import(served.declarer);
    await loader.import(served.holder);
    assert.deepEqual(
      identifyCard(getField(served.LinkHolder, 'target')!.card),
      { module: served.declarer, name: 'Target' },
      'and the same when the loader is asked for it',
    );
  });

  // The same shape in the module table rather than in a fixture: `DocxDef`
  // holds `OfficeMetadataField`, which `file-formats/metadata-fields` declares,
  // and both are bundled. This is the case the table's file-format family
  // rests on. The field class is named by the module that declares it, though
  // the loader is never asked for that module: the identity is compiled into
  // the class.
  test('a bundled def holding a bundled field class deserializes it', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await cardAPI();
    let { DocxDef } = await loader.import<any>('@cardstack/base/docx-file-def');
    let officeField = getField(DocxDef, 'officeMetadata');

    assert.deepEqual(
      identifyCard(officeField!.card),
      {
        module:
          '@cardstack/base/file-formats/metadata-fields' as RealmResourceIdentifier,
        name: 'OfficeMetadataField',
      },
      'the field class is named by the module that declares it',
    );

    let resource = {
      type: 'file-meta',
      id: 'http://example.test/doc.docx',
      attributes: {
        sourceUrl: 'http://example.test/doc.docx',
        name: 'doc.docx',
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        officeMetadata: { kind: 'word', title: 'A doc', pageCount: 3 },
      },
      meta: {
        adoptsFrom: {
          module: '@cardstack/base/docx-file-def',
          name: 'DocxDef',
        },
      },
    };
    let file = await api.createFromSerialized<any>(
      resource as any,
      { data: resource } as any,
      undefined,
    );

    assert.strictEqual(
      file.officeMetadata.title,
      'A doc',
      'the field still deserializes',
    );
    assert.strictEqual(file.officeMetadata.pageCount, 3);
  });
});
