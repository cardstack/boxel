import {
  click,
  fillIn,
  settled,
  triggerEvent,
  triggerKeyEvent,
  visit,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  baseRealmRRI,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  SupportedMimeType,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { Realm } from '@cardstack/runtime-common/realm';

import type NetworkService from '@cardstack/host/services/network';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupAuthEndpoints,
  setupUserSubscription,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import visitOperatorMode from '../helpers/visit-operator-mode';

module('Acceptance | markdown file def', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });
  let realm: Realm;

  const renderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const makeFileURL = (path: string) => new URL(path, testRealmURL).href;

  const markdownDefCodeRef = (): ResolvedCodeRef => ({
    module: `${baseRealmRRI}markdown-file-def` as RealmResourceIdentifier,
    name: 'MarkdownDef',
  });

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        if (!container) {
          return false;
        }
        let status = container.getAttribute(
          'data-prerender-file-extract-status',
        );
        if (!status) {
          return false;
        }
        if (expectedStatus && status !== expectedStatus) {
          return false;
        }
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );

    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    if (!container) {
      throw new Error(
        'captureFileExtractResult: missing [data-prerender-file-extract] container after wait',
      );
    }
    let pre = container.querySelector('pre');
    let text = pre?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    ({ realm } = await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'readme.md': `# Project Overview

This is the first paragraph.

Another paragraph follows.`,
          'notes.txt': 'Plain text file contents.',
        },
      }),
    ));
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__renderModel;
  });

  test('extracts title and excerpt from markdown', async function (assert) {
    let url = makeFileURL('readme.md');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: markdownDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(result.searchDoc?.title, 'Project Overview');
    assert.strictEqual(
      result.searchDoc?.excerpt,
      'This is the first paragraph.',
    );
    assert.ok(
      String(result.searchDoc?.content).includes(
        'This is the first paragraph.',
      ),
      'includes full markdown content',
    );
    assert.strictEqual(result.searchDoc?.name, 'readme.md');
    assert.ok(
      String(result.searchDoc?.contentType).includes('markdown'),
      'sets markdown content type',
    );
  });

  test('falls back when markdown def is used for non-markdown files', async function (assert) {
    let url = makeFileURL('notes.txt');
    await visit(
      renderPath(url, {
        fileExtract: true,
        fileDefCodeRef: markdownDefCodeRef(),
      }),
    );

    let result = await captureFileExtractResult('ready');
    assert.strictEqual(result.status, 'ready');
    assert.true(
      result.mismatch,
      'marks mismatch when extension is not markdown',
    );
    assert.strictEqual(result.searchDoc?.name, 'notes.txt');
  });

  test('indexing stores markdown search data and file meta uses it', async function (assert) {
    let fileURL = new URL('readme.md', testRealmURL);
    let fileEntry = await realm.realmIndexQueryEngine.file(fileURL);

    assert.ok(fileEntry, 'file entry exists');
    assert.strictEqual(
      fileEntry?.searchDoc?.title,
      'Project Overview',
      'index stores markdown title',
    );
    assert.strictEqual(
      fileEntry?.searchDoc?.excerpt,
      'This is the first paragraph.',
      'index stores markdown excerpt',
    );

    let network = getService('network') as NetworkService;
    let response = await network.virtualNetwork.fetch(fileURL, {
      headers: { Accept: SupportedMimeType.FileMeta },
    });

    assert.true(response.ok, 'file meta request succeeds');

    let body = await response.json();
    assert.strictEqual(body?.data?.type, 'file-meta');
    assert.ok(
      String(body?.data?.attributes?.contentType).includes('markdown'),
      'file meta uses markdown content type',
    );
    assert.strictEqual(
      body?.data?.attributes?.title,
      'Project Overview',
      'file meta includes markdown title',
    );
    assert.strictEqual(
      body?.data?.attributes?.excerpt,
      'This is the first paragraph.',
      'file meta includes markdown excerpt',
    );
    assert.ok(
      String(body?.data?.attributes?.content).includes(
        'This is the first paragraph.',
      ),
      'file meta includes markdown content',
    );
    assert.deepEqual(
      body?.data?.meta?.adoptsFrom,
      markdownDefCodeRef(),
      'file meta uses markdown def',
    );
  });
});

module('Acceptance | markdown BFM card references', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    let { createAndJoinRoom } = mockMatrixUtils;
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () =>
      setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'pet.gts': `
            import { CardDef, Component, contains, field, StringField } from '@cardstack/base/card-api';
            export class Pet extends CardDef {
              static displayName = 'Pet';
              @field name = contains(StringField);
              @field cardTitle = contains(StringField, {
                computeVia: function () {
                  return this.name;
                },
              });
              static embedded = class Embedded extends Component {
                <template>
                  <div data-test-pet-embedded>
                    <@fields.name />
                  </div>
                </template>
              };
              static atom = class Atom extends Component {
                <template>
                  <span data-test-pet-atom>{{@model.name}}</span>
                </template>
              };
            }
          `,
          'Pet/mango.json': {
            data: {
              attributes: { name: 'Mango', cardTitle: 'Mango' },
              meta: {
                adoptsFrom: { module: '../pet', name: 'Pet' },
              },
            },
          },
          'Pet/jackie.json': {
            data: {
              attributes: { name: 'Jackie', cardTitle: 'Jackie' },
              meta: {
                adoptsFrom: { module: '../pet', name: 'Pet' },
              },
            },
          },
          'bfm-test.md': [
            '# BFM Test',
            '',
            `Inline reference: :card[${testRealmURL}Pet/mango]`,
            '',
            `::card[${testRealmURL}Pet/jackie]`,
            '',
            'End of document.',
          ].join('\n'),
          'bfm-fallback.md': [
            '# Fallback Test',
            '',
            ':card[https://nonexistent.example/Card/missing]',
            '',
            '::card[https://nonexistent.example/BlogPost/gone]',
          ].join('\n'),
          'documents/notes.txt': 'These are project notes.',
          'documents/spec.txt': 'Specification details live here.',
          'bfm-file-test.md': [
            '# BFM File Test',
            '',
            `Inline reference: :file[${testRealmURL}documents/notes.txt]`,
            '',
            `::file[${testRealmURL}documents/spec.txt]`,
            '',
            'End of document.',
          ].join('\n'),
          'bfm-file-fallback.md': [
            '# File Fallback Test',
            '',
            ':file[https://nonexistent.example/missing.pdf]',
            '',
            '::file[https://nonexistent.example/gone.pdf]',
          ].join('\n'),
          // A plain markdown target embedded across the full format matrix.
          // MarkdownDef defines atom/embedded/fitted/isolated, so each combo
          // renders a distinct `data-test-markdown-*` hook.
          'documents/target.md': ['# Target Doc', '', 'Body text.'].join('\n'),
          'bfm-file-matrix.md': [
            '# BFM File Matrix',
            '',
            `:file[${testRealmURL}documents/target.md | atom]`,
            '',
            `:file[${testRealmURL}documents/target.md | embedded]`,
            '',
            `:file[${testRealmURL}documents/target.md | fitted w:200 h:150]`,
            '',
            `:file[${testRealmURL}documents/target.md | isolated]`,
            '',
            `::file[${testRealmURL}documents/target.md | atom]`,
            '',
            `::file[${testRealmURL}documents/target.md | embedded]`,
            '',
            `::file[${testRealmURL}documents/target.md | fitted w:200 h:150]`,
            '',
            `::file[${testRealmURL}documents/target.md | isolated]`,
          ].join('\n'),
          'mermaid-test.md': [
            '# Mermaid Test',
            '',
            '```mermaid',
            'flowchart TD',
            '    A[Start] --> B{Decision}',
            '    B -->|Yes| C[Result 1]',
            '    B -->|No| D[Result 2]',
            '```',
          ].join('\n'),
          'math-test.md': [
            '# Math Test',
            '',
            'The formula $E = mc^2$ is famous.',
            '',
            '$$',
            'x^2 + y^2 = z^2',
            '$$',
          ].join('\n'),
        },
      }),
    );
  });

  test('renders inline card reference in atom format and block card reference in embedded format', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-test.md`,
    });

    await settled();

    assert
      .dom('[data-test-pet-atom]')
      .exists('inline card reference renders in atom format');
    assert
      .dom('[data-test-pet-atom]')
      .hasText('Mango', 'inline atom shows correct card');
    assert
      .dom('[data-boxel-bfm-inline-ref]')
      .doesNotIncludeText(
        `${testRealmURL}Pet/mango`,
        'inline fallback path is hidden after the card resolves',
      );

    assert
      .dom('[data-test-pet-embedded]')
      .exists('block card reference renders in embedded format');
    assert.dom('[data-test-pet-embedded]').hasText('Jackie');
    assert
      .dom(
        '[data-boxel-bfm-inline-ref] [data-test-field-component-card].display-container-false',
      )
      .exists(
        'inline card reference renders without the shared card container',
      );
    assert
      .dom(
        '[data-boxel-bfm-block-ref] [data-test-field-component-card].display-container-false',
      )
      .exists('block card reference renders without the shared card container');
    assert.strictEqual(
      getComputedStyle(
        document.querySelector('[data-boxel-bfm-block-ref]') as HTMLElement,
      ).borderTopWidth,
      '0px',
      'block card wrapper does not add its own border',
    );
    assert
      .dom('[data-boxel-bfm-block-ref]')
      .doesNotIncludeText(
        `${testRealmURL}Pet/jackie`,
        'block fallback path is hidden after the card resolves',
      );
  });

  test('shows fallback text for unresolvable card references', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-fallback.md`,
    });

    await settled();

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasText(
        'Card',
        'unresolvable inline reference shows Pill with type name',
      );
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/Card/missing',
        'inline Pill title shows the raw URL',
      );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .exists('block-level unresolved reference renders a Pill');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/BlogPost/gone',
        'block Pill title shows the raw URL',
      );
  });

  test('renders inline file reference in atom format and block file reference in embedded format', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-file-test.md`,
    });

    await settled();

    // documents/notes.txt resolves to a TextFileDef, whose atom/embedded views
    // render its title — the file name without extension ('notes' / 'spec').
    assert
      .dom('[data-test-markdown-bfm-inline-file]')
      .exists('inline file reference renders a resolved file slot');
    assert
      .dom('[data-test-markdown-bfm-inline-file] [data-test-text-atom]')
      .containsText(
        'notes',
        'inline file slot renders the text file in atom format',
      );

    assert
      .dom('[data-test-markdown-bfm-block-file]')
      .exists('block file reference renders a resolved file slot');
    assert
      .dom('[data-test-markdown-bfm-block-file] [data-test-text-embedded]')
      .containsText(
        'spec',
        'block file slot renders the text file in embedded format',
      );

    assert
      .dom('[data-boxel-bfm-inline-ref]')
      .doesNotIncludeText(
        `${testRealmURL}documents/notes.txt`,
        'inline fallback path is hidden after the file resolves',
      );
  });

  test('every file format renders in both inline and block placement', async function (assert) {
    // CS-12320: the file half of the resolved-render matrix. Each format ×
    // placement must render the referenced markdown file in the requested
    // format — isolated must not collapse.
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-file-matrix.md`,
    });
    await settled();

    for (let [placement, wrapper] of [
      ['inline', '[data-test-markdown-bfm-inline-file]'],
      ['block', '[data-test-markdown-bfm-block-file]'],
    ] as const) {
      for (let format of ['atom', 'embedded', 'fitted', 'isolated'] as const) {
        assert
          .dom(`${wrapper} [data-test-markdown-${format}]`)
          .exists(`${format} file renders in ${placement} placement`);
      }
    }

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .doesNotExist('no unresolved inline file placeholders remain');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .doesNotExist('no unresolved block file placeholders remain');
  });

  test('shows fallback for unresolvable file references', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-file-fallback.md`,
    });

    await settled();

    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasText(
        'missing.pdf',
        'unresolvable inline file ref shows the file name',
      );
    assert
      .dom('[data-test-markdown-bfm-unresolved-inline]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/missing.pdf',
        'inline file fallback title shows the raw URL',
      );

    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasText('gone.pdf', 'unresolvable block file ref shows the file name');
    assert
      .dom('[data-test-markdown-bfm-unresolved-block]')
      .hasAttribute(
        'title',
        'https://nonexistent.example/gone.pdf',
        'block file fallback title shows the raw URL',
      );
  });

  test('code mode shows overlays for markdown file references', async function (assert) {
    // File slots are decorated with the same cardComponentModifier as cards
    // (mirroring how CardsGrid decorates file rows), so the overlay system
    // labels and acts on them too.
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-file-test.md`,
    });

    await settled();

    await triggerEvent('[data-test-markdown-bfm-block-file]', 'mouseenter');
    assert
      .dom('[data-test-card-overlay]')
      .exists(
        'block markdown file reference gets a hover overlay in code mode',
      );

    await triggerEvent('[data-test-markdown-bfm-inline-file]', 'mouseenter');
    assert
      .dom('[data-test-card-overlay]')
      .exists(
        'inline markdown file reference gets a hover overlay in code mode',
      );
  });

  test('code mode shows overlays for markdown card references and clicking navigates', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-test.md`,
    });

    await settled();

    let urlInput = document.querySelector(
      '[data-test-card-url-bar-input]',
    ) as HTMLInputElement | null;
    let startingValue = urlInput?.value ?? '';

    await triggerEvent('[data-test-markdown-bfm-block-card]', 'mouseenter');
    assert
      .dom('[data-test-card-overlay]')
      .exists(
        'block markdown card reference gets a hover overlay in code mode',
      );

    await triggerEvent('[data-test-markdown-bfm-inline-card]', 'mouseenter');
    assert
      .dom('[data-test-card-overlay]')
      .exists(
        'inline markdown card reference gets a hover overlay in code mode',
      );

    await click('[data-test-markdown-bfm-inline-card]');

    let navigatedValue =
      (
        document.querySelector(
          '[data-test-card-url-bar-input]',
        ) as HTMLInputElement | null
      )?.value ?? '';
    assert.notStrictEqual(
      navigatedValue,
      startingValue,
      'clicking the inline card reference navigates the URL bar',
    );
    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(`${testRealmURL}Pet/mango.json`);
  });

  test('code mode restores embedded markdown card references after navigating away and back', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}bfm-test.md`,
    });

    await settled();

    // The overlay click handler (cursor: pointer set by the Overlays component)
    // is bound once the card-reference slots resolve, which the markdown
    // rendering waiter now tracks — so `settled()` above is sufficient.
    assert.strictEqual(
      (
        document.querySelector(
          '[data-test-markdown-bfm-inline-card]',
        ) as HTMLElement | null
      )?.style.cursor,
      'pointer',
      'overlay click handler (cursor:pointer) is bound',
    );

    await click('[data-test-markdown-bfm-inline-card]');

    assert
      .dom('[data-test-card-url-bar-input]')
      .hasValue(
        `${testRealmURL}Pet/mango.json`,
        'URL bar navigates to Pet/mango.json after click',
      );

    // Navigate back to the markdown file via the URL bar (code-mode navigation
    // uses replaceState, so history.back() has no entry to return to).
    await fillIn(
      '[data-test-card-url-bar-input]',
      `${testRealmURL}bfm-test.md`,
    );
    await triggerKeyEvent(
      '[data-test-card-url-bar-input]',
      'keypress',
      'Enter',
    );

    assert
      .dom('[data-test-pet-atom]')
      .exists(
        'inline markdown card reference is restored after navigating back',
      );
    assert
      .dom('[data-test-pet-embedded]')
      .exists(
        'block markdown card reference is restored after navigating back',
      );
  });

  test('interact mode shows overlays for markdown card references and clicking navigates', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [
          {
            id: `${testRealmURL}bfm-test.md`,
            type: 'file',
            format: 'isolated',
          },
        ],
      ],
    });

    await settled();

    await triggerEvent('[data-test-markdown-bfm-inline-card]', 'mouseenter');
    assert
      .dom(`[data-test-overlay-card="${testRealmURL}Pet/mango"]`)
      .exists(
        'inline markdown card reference gets an action overlay in interact mode',
      );

    await triggerEvent('[data-test-markdown-bfm-block-card]', 'mouseenter');
    assert
      .dom(`[data-test-overlay-card="${testRealmURL}Pet/jackie"]`)
      .exists(
        'block markdown card reference gets an action overlay in interact mode',
      );

    await click('[data-test-markdown-bfm-block-card]');

    assert
      .dom(
        `[data-test-stack-card="${testRealmURL}Pet/jackie"] [data-test-card-format="isolated"]`,
      )
      .exists('clicking a block markdown card reference opens the target card');
  });

  test('mermaid code blocks are rendered as SVG diagrams', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}mermaid-test.md`,
    });

    await settled();

    assert
      .dom('pre.mermaid svg')
      .exists('mermaid code block is rendered as an SVG diagram');

    assert
      .dom('pre.mermaid')
      .doesNotIncludeText(
        'flowchart TD',
        'raw mermaid source is replaced by rendered SVG',
      );
  });

  test('math placeholders are rendered with KaTeX', async function (assert) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${testRealmURL}math-test.md`,
    });

    await settled();

    assert
      .dom('.math-placeholder .katex')
      .exists('math placeholder is rendered with KaTeX');

    // Inline math should not contain the raw LaTeX source as visible text
    assert
      .dom('.math-placeholder')
      .doesNotIncludeText(
        '$E = mc^2$',
        'raw LaTeX source is replaced by rendered math',
      );
  });
});
