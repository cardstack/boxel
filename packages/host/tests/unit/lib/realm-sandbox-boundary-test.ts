import { module, test } from 'qunit';

import { rri, type ResolvedCodeRef } from '@cardstack/runtime-common';

import {
  getOpaqueRealmCardTypeState,
  identifyRealmCard,
  isTrustedRealmCardDefinition,
  opaqueRealmCardState,
  opaqueRealmCardTypeState,
  serializeOpaqueRealmCard,
} from '@cardstack/host/lib/realm-sandbox-boundary';

import type { BaseDef } from '@cardstack/base/card-api';

module('Unit | realm sandbox boundary', function () {
  test('host UI can identify an opaque card without its executable constructor', function (assert) {
    let typeRef = {
      module: 'https://realm.example/article',
      name: 'Article',
    } as ResolvedCodeRef;
    class OpaqueRealmCard {}
    Object.defineProperty(OpaqueRealmCard, opaqueRealmCardTypeState, {
      value: Object.freeze({
        typeRef,
        definitionKind: 'card',
        ancestorTypes: [],
        displayName: 'Article',
        fields: Object.freeze({}),
        hasCustomEditTemplate: true,
        hasCustomIsolatedTemplate: true,
        headerColor: null,
        prefersWideFormat: false,
      }),
    });

    let card = new OpaqueRealmCard();

    assert.deepEqual(identifyRealmCard(card), typeRef);
    assert.deepEqual(getOpaqueRealmCardTypeState(card)?.typeRef, typeRef);
    assert.deepEqual(
      getOpaqueRealmCardTypeState(OpaqueRealmCard)?.typeRef,
      typeRef,
      'the same inert metadata is available to constructor-based host APIs',
    );
    assert.false(
      isTrustedRealmCardDefinition(card),
      'a realm-authored opaque definition is not trusted',
    );
  });

  test('the prerender trust decision follows the definition module', function (assert) {
    class TrustedOpaqueRealmCard {}
    Object.defineProperty(TrustedOpaqueRealmCard, opaqueRealmCardTypeState, {
      value: Object.freeze({
        typeRef: {
          module: '@cardstack/base/card-api',
          name: 'CardDef',
        } as ResolvedCodeRef,
        definitionKind: 'card',
        ancestorTypes: [],
        displayName: 'Card',
        fields: Object.freeze({}),
        hasCustomEditTemplate: true,
        hasCustomIsolatedTemplate: true,
        headerColor: null,
        prefersWideFormat: false,
      }),
    });

    assert.true(
      isTrustedRealmCardDefinition(new TrustedOpaqueRealmCard()),
      'an opaque boundary does not hide a trusted Base definition',
    );
  });

  test('host persistence serializes an opaque card through its JSON boundary', function (assert) {
    let card = {
      id: 'temporary-local-uuid',
      title: 'Edited in the host',
    } as unknown as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://realm.example/',
        document: {
          data: {
            type: 'card',
            attributes: { title: 'Original title' },
            meta: {
              adoptsFrom: {
                module: 'https://realm.example/article',
                name: 'Article',
              } as ResolvedCodeRef,
            },
          },
        },
        snapshot: { title: 'Original title' },
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.deepEqual(serializeOpaqueRealmCard(card), {
      data: {
        type: 'card',
        attributes: { title: 'Edited in the host' },
        meta: {
          adoptsFrom: {
            module: rri('https://realm.example/article'),
            name: 'Article',
          },
        },
      },
    });
  });

  test('host persistence preserves an opaque card remote id', function (assert) {
    let card = {
      id: 'temporary-or-runtime-id',
      title: 'Edited in the host',
    } as unknown as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://realm.example/',
        document: {
          data: {
            type: 'card',
            id: 'https://realm.example/Article/one',
            attributes: { title: 'Original title' },
            meta: {
              adoptsFrom: {
                module: 'https://realm.example/article',
                name: 'Article',
              } as ResolvedCodeRef,
            },
          },
        },
        snapshot: { title: 'Original title' },
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.strictEqual(
      serializeOpaqueRealmCard(card)?.data.id,
      'https://realm.example/Article/one',
      'the canonical realm id comes from the opaque document, not executable object state',
    );
  });

  test('host copy serialization makes opaque references absolute', function (assert) {
    let card = {} as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://realm.example/',
        document: {
          data: {
            type: 'card',
            id: 'https://realm.example/Article/one',
            relationships: {
              author: {
                links: { self: '../Author/two' },
              },
            },
            meta: {
              adoptsFrom: {
                module: '../article',
                name: 'Article',
              } as ResolvedCodeRef,
            },
          },
        },
        snapshot: {},
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.deepEqual(serializeOpaqueRealmCard(card, { useAbsoluteURL: true }), {
      data: {
        type: 'card',
        id: 'https://realm.example/Article/one',
        relationships: {
          author: {
            links: { self: 'https://realm.example/Author/two' },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri('https://realm.example/article'),
            name: 'Article',
          },
        },
      },
    });
  });

  test('host persistence keeps nested linked cards in JSON:API relationships', function (assert) {
    let linkedTheme = {
      id: 'https://realm.example/Theme/starry-night',
      hostCapability: () => 'must not cross the JSON boundary',
    };
    let rawCardInfo = {
      name: 'Edited title',
      theme: linkedTheme,
    };
    let card = {
      cardInfo: new Proxy(rawCardInfo, {}),
    } as unknown as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://realm.example/',
        document: {
          data: {
            type: 'card',
            id: 'https://realm.example/Article/one',
            attributes: {
              cardInfo: {
                name: 'Original title',
              },
            },
            relationships: {
              'cardInfo.theme': {
                links: { self: '../Theme/starry-night' },
              },
            },
            meta: {
              adoptsFrom: {
                module: 'https://realm.example/article',
                name: 'Article',
              } as ResolvedCodeRef,
            },
          },
        },
        snapshot: {
          cardInfo: rawCardInfo,
        },
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.deepEqual(serializeOpaqueRealmCard(card), {
      data: {
        type: 'card',
        id: 'https://realm.example/Article/one',
        attributes: {
          cardInfo: {
            name: 'Edited title',
          },
        },
        relationships: {
          'cardInfo.theme': {
            links: { self: '../Theme/starry-night' },
          },
        },
        meta: {
          adoptsFrom: {
            module: rri('https://realm.example/article'),
            name: 'Article',
          },
        },
      },
    });
  });

  test('an id-less copied opaque card keeps already-absolute references', function (assert) {
    let card = {} as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://target.example/',
        document: {
          data: {
            type: 'card',
            meta: {
              adoptsFrom: {
                module: 'https://realm.example/article',
                name: 'Article',
              } as ResolvedCodeRef,
            },
          },
        },
        snapshot: {},
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.deepEqual(
      serializeOpaqueRealmCard(card, { useAbsoluteURL: true })?.data.meta
        .adoptsFrom,
      {
        module: rri('https://realm.example/article'),
        name: 'Article',
      },
    );
  });

  test('host persistence fails closed for a non-serializable edited field', function (assert) {
    let card = {
      title: () => 'host capability',
    } as unknown as BaseDef;
    Object.defineProperty(card, opaqueRealmCardState, {
      value: {
        typeRef: {
          module: 'https://realm.example/article',
          name: 'Article',
        } as ResolvedCodeRef,
        principal: 'https://realm.example/',
        document: {
          data: {
            type: 'card',
            attributes: { title: 'Last serializable title' },
          },
        },
        snapshot: { title: 'Last serializable title' },
        presentation: {
          headerColor: null,
          prefersWideFormat: false,
        },
      },
    });

    assert.throws(
      () => serializeOpaqueRealmCard(card),
      /Cannot serialize sandboxed card field "title"/,
      'a failed edit cannot silently preserve and save stale field data',
    );
  });
});
