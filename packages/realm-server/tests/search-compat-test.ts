import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  searchEntryDocToPrerenderedDoc,
  rri,
  type SearchEntryCollectionDocument,
} from '@cardstack/runtime-common';

const realmURL = 'http://localhost:4201/test/';
const cardId = `${realmURL}jane`;
const fancyRef = {
  module: rri(`${realmURL}fancy-person`),
  name: 'FancyPerson',
};
const personRef = { module: rri(`${realmURL}person`), name: 'Person' };
const baseRef = { module: rri(`${realmURL}base-thing`), name: 'BaseThing' };

function htmlResource(renderType: { module: string; name: string }) {
  return {
    type: 'html' as const,
    id: `${cardId}#embedded#${renderType.module}/${renderType.name}`,
    attributes: {
      html: `<div>${renderType.name}</div>`,
      cardType: renderType.name,
      format: 'embedded' as const,
      renderType: renderType as any,
    },
    relationships: { styles: { data: [] } },
  };
}

// A doc whose entry carries the whole adoption chain's renderings (the
// translated explicit-renderType query opens the chain universe), with the
// item's adoptsFrom RELATIVE to the instance — the serialized form.
function chainDoc(memberRefs: { module: string; name: string }[]) {
  let members = memberRefs.map(htmlResource);
  let doc: SearchEntryCollectionDocument = {
    data: [
      {
        type: 'search-entry',
        id: cardId,
        relationships: {
          html: {
            data: members.map((m) => ({ type: 'html', id: m.id })),
          },
          item: { data: { type: 'card', id: cardId } },
        },
      },
    ],
    included: [
      ...members,
      {
        type: 'card',
        id: cardId as any,
        attributes: { firstName: 'Jane' },
        meta: {
          adoptsFrom: { module: rri('./fancy-person'), name: 'FancyPerson' },
        },
        links: { self: cardId },
      },
    ],
    meta: { page: { total: 1 } },
  };
  return doc;
}

module(basename(import.meta.filename), function () {
  module('prerendered coalescing: renderType pick', function () {
    test('picks the requested ancestor when its rendering exists', function (assert) {
      let doc = searchEntryDocToPrerenderedDoc(
        chainDoc([fancyRef, personRef, baseRef]),
        { renderType: personRef },
      );
      assert.strictEqual(doc.data[0].attributes.html, '<div>Person</div>');
      assert.deepEqual(doc.data[0].meta.adoptsFrom, personRef);
    });

    test('falls back to the native rendering — matched through a relative item adoptsFrom', function (assert) {
      let doc = searchEntryDocToPrerenderedDoc(chainDoc([fancyRef, baseRef]), {
        renderType: personRef,
      });
      assert.strictEqual(
        doc.data[0].attributes.html,
        '<div>FancyPerson</div>',
        'the native rendering, not an arbitrary ancestor',
      );
    });

    test('emits html:"" when neither the requested nor the native rendering exists', function (assert) {
      let doc = searchEntryDocToPrerenderedDoc(chainDoc([baseRef]), {
        renderType: personRef,
      });
      assert.strictEqual(
        doc.data[0].attributes.html,
        '',
        'an unrelated ancestor is never substituted',
      );
      assert.deepEqual(
        doc.data[0].meta.adoptsFrom,
        { module: rri('./fancy-person'), name: 'FancyPerson' },
        'the actual type rides from the item',
      );
    });
  });

  module('prerendered coalescing: isFileMeta', function () {
    test('the dispatch-level signal survives an empty result', function (assert) {
      let empty: SearchEntryCollectionDocument = {
        data: [],
        meta: { page: { total: 0 } },
      };
      assert.true(
        searchEntryDocToPrerenderedDoc(empty, { isFileMeta: true }).meta
          .isFileMeta,
      );
      assert.strictEqual(
        searchEntryDocToPrerenderedDoc(empty, {}).meta.isFileMeta,
        undefined,
      );
    });
  });
});
