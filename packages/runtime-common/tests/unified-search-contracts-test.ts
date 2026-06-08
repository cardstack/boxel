import type { SharedTests } from '../helpers';
import { rri, type RealmResourceIdentifier } from '../realm-identifiers';
import type {
  CardResource,
  CssResource,
  RenderedHtmlResource,
} from '../resource-types';
import {
  cssResourceId,
  isCardResource,
  isCssResource,
  isIdentityOnlyCardResource,
  isRenderedHtmlResource,
} from '../resource-types';
import { parseUnifiedSearchRequestFromPayload } from '../search-utils';

const realmURL = 'http://localhost:4201/test/';
const cardUrl = rri(`${realmURL}Author/1`);

const authorRef = {
  module: `${realmURL}author` as RealmResourceIdentifier,
  name: 'Author',
};

function fullCard(): CardResource {
  return {
    type: 'card',
    id: cardUrl,
    attributes: { name: 'Mango' },
    meta: { adoptsFrom: authorRef },
    links: { self: cardUrl },
  };
}

function identityOnlyCard(): CardResource {
  return {
    type: 'card',
    id: cardUrl,
    relationships: {
      'rendered-html': {
        data: { type: 'rendered-html', id: cardUrl },
      },
    },
    meta: { adoptsFrom: authorRef, identityOnly: true },
    links: { self: cardUrl },
  };
}

function renderedHtml(): RenderedHtmlResource {
  return {
    type: 'rendered-html',
    id: cardUrl,
    attributes: { html: '<div>Mango</div>', cardType: 'Author' },
    relationships: { styles: { data: [{ type: 'css', id: 'abc123' }] } },
  };
}

function css(
  href = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`,
): CssResource {
  return {
    type: 'css',
    id: cssResourceId(href),
    attributes: { href },
  };
}

const tests = Object.freeze({
  // --- predicates -----------------------------------------------------------

  'isIdentityOnlyCardResource keys on meta.identityOnly, not attribute-absence':
    async (assert) => {
      assert.true(isCardResource(fullCard()), 'full card is a card resource');
      assert.false(
        isIdentityOnlyCardResource(fullCard()),
        'a full card (attributes, no flag) is not identity-only',
      );
      assert.true(
        isIdentityOnlyCardResource(identityOnlyCard()),
        'a flagged identity-only card is identity-only',
      );

      // The flag — not the relationship and not attribute-absence — is the
      // discriminator.
      let relWithoutFlag = identityOnlyCard();
      relWithoutFlag.meta = { adoptsFrom: authorRef };
      assert.false(
        isIdentityOnlyCardResource(relWithoutFlag),
        'a rendered-html relationship without the flag is not identity-only',
      );

      let noAttributesNoFlag: CardResource = {
        type: 'card',
        id: cardUrl,
        relationships: {
          friend: { links: { self: `${realmURL}Author/2` } },
        },
        meta: { adoptsFrom: authorRef },
      };
      assert.false(
        isIdentityOnlyCardResource(noAttributesNoFlag),
        'a full card that merely lacks attributes is not identity-only',
      );
    },

  'isRenderedHtmlResource recognizes a rendered-html resource': async (
    assert,
  ) => {
    assert.true(isRenderedHtmlResource(renderedHtml()));
    assert.false(
      isRenderedHtmlResource(fullCard()),
      'a card is not a rendered-html resource',
    );
    assert.false(
      isRenderedHtmlResource({
        type: 'rendered-html',
        id: cardUrl,
        attributes: { cardType: 'Author' },
        relationships: { styles: { data: [] } },
      }),
      'a rendered-html resource without html is rejected',
    );
    assert.false(
      isRenderedHtmlResource({
        type: 'rendered-html',
        id: cardUrl,
        attributes: { html: '<div></div>' },
        relationships: { styles: { data: [] } },
      }),
      'a rendered-html resource without cardType is rejected',
    );
    assert.false(
      isRenderedHtmlResource({
        type: 'rendered-html',
        id: cardUrl,
        attributes: { html: '<div></div>', cardType: 'Author' },
      }),
      'a rendered-html resource without a styles relationship is rejected',
    );
  },

  'isCssResource recognizes a css resource': async (assert) => {
    assert.true(isCssResource(css()));
    assert.false(
      isCssResource(renderedHtml()),
      'a rendered-html resource is not a css resource',
    );
    assert.false(
      isCssResource({ type: 'css', id: 'abc', attributes: {} }),
      'a css resource without href is rejected',
    );
  },

  // --- request parse --------------------------------------------------------

  'parse: render.format is used when provided': async (assert) => {
    let { render, dataOnly } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      render: { format: 'embedded' },
    });
    assert.strictEqual(render?.format, 'embedded');
    assert.notOk(dataOnly, 'a render request is not data-only');
  },

  'parse: render.format defaults to fitted when omitted': async (assert) => {
    let { render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      render: {},
    });
    assert.strictEqual(render?.format, 'fitted');
  },

  'parse: render.renderType accepts a CodeRef': async (assert) => {
    let { render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      render: { renderType: authorRef },
    });
    assert.deepEqual(render?.renderType, authorRef);
  },

  'parse: render.renderType accepts the "native" escape valve': async (
    assert,
  ) => {
    let { render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      render: { renderType: 'native' },
    });
    assert.strictEqual(render?.renderType, 'native');
  },

  'parse: render.renderType omitted leaves renderType unset': async (
    assert,
  ) => {
    let { render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      render: { format: 'fitted' },
    });
    assert.strictEqual(render?.renderType, undefined);
  },

  'parse: invalid renderType is rejected': async (assert) => {
    assert.throws(() =>
      parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: { renderType: 'bogus' },
      }),
    );
  },

  'parse: a non-object body is rejected': async (assert) => {
    // null / string / number must not coerce to an empty broad search.
    for (let bad of [null, 'a string', 42, true]) {
      assert.throws(
        () => parseUnifiedSearchRequestFromPayload(bad as unknown),
        /must be a JSON object/,
        `rejects ${JSON.stringify(bad)}`,
      );
    }
  },

  'parse: an invalid render.format is rejected': async (assert) => {
    assert.throws(
      () =>
        parseUnifiedSearchRequestFromPayload({
          realms: [realmURL],
          render: { format: 'bogus' },
        }),
      /render\.format/,
    );
  },

  'parse: a non-object render is rejected': async (assert) => {
    assert.throws(
      () =>
        parseUnifiedSearchRequestFromPayload({
          realms: [realmURL],
          render: 'oops',
        }),
      /render must be an object/,
    );
  },

  'parse: render combined with dataOnly is rejected': async (assert) => {
    // The two are mutually exclusive modes; a contradictory payload must not
    // silently succeed (and a malformed render must not be swallowed).
    assert.throws(
      () =>
        parseUnifiedSearchRequestFromPayload({
          realms: [realmURL],
          dataOnly: true,
          render: { format: 'fitted' },
        }),
      /mutually exclusive/,
    );
  },

  'parse: dataOnly true yields live-only with no render': async (assert) => {
    let { dataOnly, render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      dataOnly: true,
    });
    assert.true(dataOnly, 'dataOnly is honored');
    assert.strictEqual(render, undefined, 'data-only carries no render spec');
  },

  'parse: a body with no render is not data-only': async (assert) => {
    let { dataOnly, render } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
    });
    assert.notOk(dataOnly, 'a missing render must NOT be read as data-only');
    assert.strictEqual(
      render?.format,
      'fitted',
      'prefer-HTML is the default with the fitted format',
    );
  },

  'parse: cardUrls round-trips': async (assert) => {
    let urls = [`${realmURL}Author/1`, `${realmURL}Author/2`];
    let { cardUrls } = parseUnifiedSearchRequestFromPayload({
      realms: [realmURL],
      cardUrls: urls,
    });
    assert.deepEqual(cardUrls, urls);
  },

  // --- css hash helper ------------------------------------------------------

  'cssResourceId is stable and dedupes identical CSS': async (assert) => {
    let href = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`;
    assert.strictEqual(
      cssResourceId(href),
      cssResourceId(href),
      'stable for the same href',
    );
    assert.strictEqual(
      cssResourceId(href),
      cssResourceId(`${href}`),
      'identical CSS URL → identical id (dedup)',
    );
    assert.notStrictEqual(
      cssResourceId(href),
      cssResourceId(`${realmURL}Pet.gts.WHpublished.glimmer-scoped.css`),
      'different CSS URL → different id',
    );
  },
} as SharedTests<{}>);

export default tests;
