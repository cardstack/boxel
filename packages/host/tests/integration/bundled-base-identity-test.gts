import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { Loader, getField, identifyCard } from '@cardstack/runtime-common';

import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type * as CardAPIModule from '@cardstack/base/card-api';

// A pair of modules standing in for two bundled base modules: `declarer`
// declares a FieldDef, and `holder` holds it as a field. The holder names the
// class by JS reference rather than by asking the loader for it, which is what
// bundling leaves behind — the bundler resolves a bundled module's import
// inside the chunk, so the loader is never asked for the declarer.
const DECLARER = 'http://bundled-identity.test/declarer';
const HOLDER = 'http://bundled-identity.test/holder';

// The same shape with a link in place of the contained field, built fresh per
// call so each case gets classes no earlier one has named.
let linkPairs = 0;
function defineLinkedPair(api: typeof CardAPIModule) {
  let { CardDef, field, linksTo } = api;
  let n = linkPairs++;
  let declarer = `http://bundled-identity.test/link-declarer-${n}`;
  let holder = `http://bundled-identity.test/link-holder-${n}`;

  class Target extends CardDef {
    static displayName = 'Target';
  }
  class LinkHolder extends CardDef {
    static displayName = 'LinkHolder';
    @field target = linksTo(Target);
  }

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

  // The loader names the classes of every module it is asked for, and it is
  // never asked for a module reachable only from inside another module's
  // chunk. A class held as a field is named anyway, but not by the loader:
  // resolving the field records where it is held, and that record is what
  // names it.
  test('a class only a bundled sibling names is identified through its holder', async function (assert) {
    let loader = getService('loader-service').loader;
    let { Detail, Holder } = defineBundledPair(await cardAPI());

    await loader.import(HOLDER);

    assert.deepEqual(
      Loader.identify(Holder),
      { module: HOLDER, name: 'Holder' },
      'the module the loader was asked for names its own class',
    );
    assert.strictEqual(
      Loader.identify(Detail),
      undefined,
      'the module the loader was never asked for names nothing',
    );
    assert.strictEqual(
      identifyCard(Detail),
      undefined,
      'and until the field is resolved, nothing else names it either',
    );

    assert.strictEqual(
      getField(Holder, 'detail')!.card,
      Detail,
      'resolving the field reaches the same class',
    );
    assert.deepEqual(
      identifyCard(Detail),
      {
        type: 'fieldOf',
        field: 'detail',
        card: { module: HOLDER, name: 'Holder' },
      },
      'which is what names it: the field of the holder it is declared on',
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
      api.serializeCard(card as any).data.meta,
      { adoptsFrom: { module: HOLDER, name: 'Holder' } },
      'the round trip records the holder and nothing about the field',
    );
  });

  // Why the attribution rule asks about links and not contained fields. A link
  // carries its type as data — the chooser searches by it — so the two orders
  // have to name the same module, and they do not: served, the ref names the
  // module that declares the class; unserved, it names the field it is held as.
  test('a link to such a class names the field rather than the module', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await cardAPI();

    let unserved = defineLinkedPair(api);
    await loader.import(unserved.holder);
    assert.strictEqual(
      Loader.identify(unserved.Target),
      undefined,
      'the module declaring the link target is never asked for',
    );
    assert.deepEqual(
      identifyCard(getField(unserved.LinkHolder, 'target')!.card),
      {
        type: 'fieldOf',
        field: 'target',
        card: { module: unserved.holder, name: 'LinkHolder' },
      },
      'so the type a chooser would filter by names the field',
    );

    let served = defineLinkedPair(api);
    await loader.import(served.declarer);
    await loader.import(served.holder);
    assert.deepEqual(
      identifyCard(getField(served.LinkHolder, 'target')!.card),
      { module: served.declarer, name: 'Target' },
      'and names the declaring module once the loader is asked for it',
    );
  });

  // The same shape in the module table rather than in a fixture: `DocxDef`
  // holds `OfficeMetadataField`, which `file-formats/metadata-fields` declares,
  // and both are bundled. This is the case the table's file-format family
  // rests on, in a loader that has been asked for nothing else.
  test('a bundled def holding a bundled field class deserializes it', async function (assert) {
    let loader = getService('loader-service').loader;
    let api = await cardAPI();
    let { DocxDef } = await loader.import<any>('@cardstack/base/docx-file-def');
    let officeField = getField(DocxDef, 'officeMetadata');

    assert.strictEqual(
      Loader.identify(officeField!.card),
      undefined,
      'the loader is never asked for the module declaring the field class',
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
      'the field whose class the loader never named still deserializes',
    );
    assert.strictEqual(file.officeMetadata.pageCount, 3);
  });
});
