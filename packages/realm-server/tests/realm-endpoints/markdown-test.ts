import { module, test } from 'qunit';
import type { SuperTest, Test } from 'supertest';
import { basename } from 'path';
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import { SupportedMimeType } from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../../server';
import { closeServer, setupPermissionedRealmCached } from '../helpers';

// CS-10789 end-to-end tests for the markdown rendering pipeline (CS-10782
// through CS-10787) as served via the realm HTTP endpoint added in CS-10798.
//
// Each test requests a pre-indexed card with `Accept: text/markdown` and
// asserts the response body. The fileSystem is seeded once per template-DB
// build (setupPermissionedRealmCached) so per-test setup cost is a DB restore.
//
// Coverage:
//   1.  Format resolution — GET with `Accept: text/markdown` returns markdown.
//   2.  Whitespace preservation — multi-line indented content round-trips.
//   3.  Field delegation — `<@fields.x />` resolves to the field's markdown.
//   4.  MarkdownField passthrough — raw markdown is not escaped.
//   5.  markdownEscape — user content with metacharacters is escaped.
//   6.  HTML-to-markdown fallback — CardDef default converts isolated HTML.
//   7.  Override precedence — subclass static markdown wins over the fallback.
//   8.  Frontmatter — YAML frontmatter in the template is preserved.
//   9.  Nested cards — parent template embeds child card markdown.
//   10. Content-type header — response advertises `text/markdown`.
//   11. Cache invalidation — updating a card changes the served markdown.

const BASIC_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Basic extends CardDef {
    static displayName = 'Basic';
    @field title = contains(StringField);
    static isolated = class extends Component<typeof this> {
      <template>
        <h1 data-test-card><@fields.title /></h1>
      </template>
    };
    // Authoring markdown directly; overrides the CardDef fallback.
    static markdown = class extends Component<typeof this> {
      <template># {{@model.title}}</template>
    };
  }
`;

// Whitespace-preservation card: the authored markdown is a fenced code block
// with deliberately nested indentation. The render route wraps the output in
// `[data-markdown-render-container]` with `white-space: pre`, and the
// prerender pipeline captures `textContent` for format=markdown, so the exact
// whitespace must round-trip.
const WHITESPACE_CARD_GTS = `
  import { Component, CardDef } from 'https://cardstack.com/base/card-api';

  export class Whitespace extends CardDef {
    static displayName = 'Whitespace';
    static markdown = class extends Component<typeof this> {
      <template>## Snippet
\`\`\`js
function hi() {
    if (true) {
        return 'ok';
    }
}
\`\`\`</template>
    };
  }
`;

// Field delegation: the parent's markdown template renders
// `<@fields.name @format='markdown' />`, which dispatches to StringField's
// static markdown (markdownEscape). `*Alice*` should come back as `\*Alice\*`.
const FIELD_DELEGATION_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class FieldDelegation extends CardDef {
    static displayName = 'FieldDelegation';
    @field name = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template>Hello, <@fields.name @format='markdown' />!</template>
    };
  }
`;

// MarkdownField passthrough: author raw markdown via MarkdownField; the
// field's `static markdown` is `{{@model}}` (no escape) so inline formatting
// like `**bold**` must survive into the output.
const MARKDOWN_FIELD_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import MarkdownField from 'https://cardstack.com/base/markdown';

  export class PassThrough extends CardDef {
    static displayName = 'PassThrough';
    @field body = contains(MarkdownField);
    static markdown = class extends Component<typeof this> {
      <template><@fields.body @format='markdown' /></template>
    };
  }
`;

// markdownEscape via StringField default: the raw value contains markdown
// metacharacters that would otherwise trigger formatting. The expected
// output escapes each of them with a backslash.
const ESCAPE_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Escape extends CardDef {
    static displayName = 'Escape';
    @field value = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template><@fields.value @format='markdown' /></template>
    };
  }
`;

// HTML-to-markdown fallback: only an isolated HTML template is provided; the
// CardDef default `static markdown` fallback (CS-10784) converts the HTML to
// markdown via turndown in the browser prerenderer (globalThis.__boxelHtmlToMarkdown).
const FALLBACK_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Fallback extends CardDef {
    static displayName = 'Fallback';
    @field title = contains(StringField);
    static isolated = class extends Component<typeof this> {
      <template>
        <h1>{{@model.title}}</h1>
        <p>Body paragraph.</p>
      </template>
    };
    // No static markdown override — CardDef fallback applies.
  }
`;

// Override precedence: isolated HTML would yield "# Wrong" if the fallback
// ran, but the authored `static markdown` must take precedence.
const OVERRIDE_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Override extends CardDef {
    static displayName = 'Override';
    @field title = contains(StringField);
    static isolated = class extends Component<typeof this> {
      <template>
        <h1>Wrong</h1>
      </template>
    };
    static markdown = class extends Component<typeof this> {
      <template># {{@model.title}} (authored)</template>
    };
  }
`;

// Explicit frontmatter: author YAML frontmatter verbatim; the pipeline must
// not auto-inject or mutate it. The template dash-fence must round-trip.
const FRONTMATTER_CARD_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Frontmatter extends CardDef {
    static displayName = 'Frontmatter';
    @field title = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template>---
title: {{@model.title}}
---
# Body</template>
    };
  }
`;

// Nested card composition: parent embeds a contained CardDef via
// `<@fields.child @format='markdown' />`. The child's authored markdown
// must appear in the parent output.
const NESTED_CARD_GTS = `
  import {
    contains,
    linksTo,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class NestedChild extends CardDef {
    static displayName = 'NestedChild';
    @field childTitle = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template>## {{@model.childTitle}}</template>
    };
  }

  export class NestedParent extends CardDef {
    static displayName = 'NestedParent';
    @field parentTitle = contains(StringField);
    @field child = linksTo(() => NestedChild);
    static markdown = class extends Component<typeof this> {
      <template># {{@model.parentTitle}}

<@fields.child @format='markdown' /></template>
    };
  }
`;

// Cache invalidation target: starts with one body, test rewrites then re-indexes.
const CACHE_CARD_INITIAL_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Cache extends CardDef {
    static displayName = 'Cache';
    @field title = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template>Version 1: {{@model.title}}</template>
    };
  }
`;

const CACHE_CARD_UPDATED_GTS = `
  import {
    contains,
    field,
    Component,
    CardDef,
  } from 'https://cardstack.com/base/card-api';
  import StringField from 'https://cardstack.com/base/string';

  export class Cache extends CardDef {
    static displayName = 'Cache';
    @field title = contains(StringField);
    static markdown = class extends Component<typeof this> {
      <template>Version 2: {{@model.title}}</template>
    };
  }
`;

module(`realm-endpoints/${basename(__filename)}`, function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;
  let request: SuperTest<Test>;

  function onRealmSetup({
    testRealm: realm,
    testRealmHttpServer: server,
    request: req,
  }: {
    testRealm: Realm;
    testRealmHttpServer: Server;
    request: SuperTest<Test>;
  }) {
    testRealm = realm;
    testRealmHttpServer = server;
    request = req;
  }

  hooks.afterEach(async function () {
    await closeServer(testRealmHttpServer);
  });

  setupPermissionedRealmCached(hooks, {
    permissions: {
      '*': ['read'],
    },
    fileSystem: {
      'basic.gts': BASIC_CARD_GTS,
      'basic.json': {
        data: {
          type: 'card',
          attributes: { title: 'Hello' },
          meta: {
            adoptsFrom: {
              module: rri('./basic.gts'),
              name: 'Basic',
            },
          },
        },
      },
      'whitespace.gts': WHITESPACE_CARD_GTS,
      'whitespace.json': {
        data: {
          type: 'card',
          attributes: {},
          meta: {
            adoptsFrom: {
              module: rri('./whitespace.gts'),
              name: 'Whitespace',
            },
          },
        },
      },
      'field-delegation.gts': FIELD_DELEGATION_CARD_GTS,
      'field-delegation.json': {
        data: {
          type: 'card',
          attributes: { name: '*Alice*' },
          meta: {
            adoptsFrom: {
              module: rri('./field-delegation.gts'),
              name: 'FieldDelegation',
            },
          },
        },
      },
      'markdown-field.gts': MARKDOWN_FIELD_CARD_GTS,
      'markdown-field.json': {
        data: {
          type: 'card',
          attributes: { body: 'Some **bold** text' },
          meta: {
            adoptsFrom: {
              module: rri('./markdown-field.gts'),
              name: 'PassThrough',
            },
          },
        },
      },
      'escape.gts': ESCAPE_CARD_GTS,
      'escape.json': {
        data: {
          type: 'card',
          attributes: { value: 'Hello *world* [link]' },
          meta: {
            adoptsFrom: {
              module: rri('./escape.gts'),
              name: 'Escape',
            },
          },
        },
      },
      'fallback.gts': FALLBACK_CARD_GTS,
      'fallback.json': {
        data: {
          type: 'card',
          attributes: { title: 'Fallback Title' },
          meta: {
            adoptsFrom: {
              module: rri('./fallback.gts'),
              name: 'Fallback',
            },
          },
        },
      },
      'override.gts': OVERRIDE_CARD_GTS,
      'override.json': {
        data: {
          type: 'card',
          attributes: { title: 'Right' },
          meta: {
            adoptsFrom: {
              module: rri('./override.gts'),
              name: 'Override',
            },
          },
        },
      },
      'frontmatter.gts': FRONTMATTER_CARD_GTS,
      'frontmatter.json': {
        data: {
          type: 'card',
          attributes: { title: 'Featured' },
          meta: {
            adoptsFrom: {
              module: rri('./frontmatter.gts'),
              name: 'Frontmatter',
            },
          },
        },
      },
      'nested.gts': NESTED_CARD_GTS,
      'nested-child.json': {
        data: {
          type: 'card',
          attributes: { childTitle: 'Child' },
          meta: {
            adoptsFrom: {
              module: rri('./nested.gts'),
              name: 'NestedChild',
            },
          },
        },
      },
      'nested-parent.json': {
        data: {
          type: 'card',
          attributes: { parentTitle: 'Parent' },
          relationships: {
            child: {
              links: { self: './nested-child' },
            },
          },
          meta: {
            adoptsFrom: {
              module: rri('./nested.gts'),
              name: 'NestedParent',
            },
          },
        },
      },
      'cache.gts': CACHE_CARD_INITIAL_GTS,
      'cache.json': {
        data: {
          type: 'card',
          attributes: { title: 'Alpha' },
          meta: {
            adoptsFrom: {
              module: rri('./cache.gts'),
              name: 'Cache',
            },
          },
        },
      },
    },
    onRealmSetup,
  });

  // Case 1: Format resolution
  test('GET with Accept: text/markdown returns the card markdown body', async function (assert) {
    let response = await request
      .get('/basic')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.text.trim(),
      '# Hello',
      'body is the authored markdown',
    );
  });

  // Case 10: Content-type header
  test('response advertises text/markdown content-type', async function (assert) {
    let response = await request
      .get('/basic')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // Match on media type; the handler pins `text/markdown; charset=utf-8`
    // but we tolerate any parameter tail rather than over-constraining.
    assert.true(
      /^text\/markdown(;|$)/.test(response.headers['content-type'] ?? ''),
      `content-type starts with text/markdown: got "${response.headers['content-type']}"`,
    );
  });

  test('unknown card path returns 404', async function (assert) {
    let response = await request
      .get('/does-not-exist')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 404, 'HTTP 404 status');
  });

  // Case 2: Whitespace preservation
  test('multi-line indented markdown round-trips without whitespace collapsing', async function (assert) {
    let response = await request
      .get('/whitespace')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // Indentation inside the fenced block is meaningful; `textContent` capture
    // on a `white-space: pre` container must preserve it verbatim.
    assert.true(
      response.text.includes('    if (true) {'),
      `inner indentation preserved: ${response.text}`,
    );
    assert.true(
      response.text.includes('        return'),
      `nested indentation preserved: ${response.text}`,
    );
    assert.true(
      response.text.includes('```js'),
      `opening fence preserved: ${response.text}`,
    );
  });

  // Case 3: Field delegation
  test('<@fields.x @format=markdown /> dispatches to the field static markdown', async function (assert) {
    let response = await request
      .get('/field-delegation')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // StringField's static markdown wraps the value in `markdownEscape`.
    // The asterisks in `*Alice*` get backslash-escaped.
    assert.true(
      response.text.includes('\\*Alice\\*'),
      `StringField escape applied: ${response.text}`,
    );
    assert.true(
      response.text.includes('Hello,'),
      `surrounding template preserved: ${response.text}`,
    );
  });

  // Case 4: MarkdownField passthrough
  test('MarkdownField passthrough does not escape metacharacters', async function (assert) {
    let response = await request
      .get('/markdown-field')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // MarkdownField overrides StringField's escape with `{{@model}}`, so
    // `**bold**` must survive to the wire without backslash escaping.
    assert.true(
      response.text.includes('**bold**'),
      `MarkdownField passthrough preserved: ${response.text}`,
    );
    assert.false(
      response.text.includes('\\*\\*bold\\*\\*'),
      `MarkdownField is NOT escaped: ${response.text}`,
    );
  });

  // Case 5: markdownEscape for user content via StringField default
  test('StringField markdownEscape backslashes metacharacters in user content', async function (assert) {
    let response = await request
      .get('/escape')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // `*`, `[`, and `]` are in the escape set. Expected exact string:
    //   Hello \*world\* \[link\]
    assert.strictEqual(
      response.text.trim(),
      'Hello \\*world\\* \\[link\\]',
      `escape output exact: ${response.text}`,
    );
  });

  // Case 6: HTML-to-markdown fallback (via CardDef default)
  test('CardDef fallback converts isolated HTML to markdown when no static markdown', async function (assert) {
    let response = await request
      .get('/fallback')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    // Turndown converts `<h1>X</h1>` to `# X` (ATX-style heading). The exact
    // formatting depends on the host's turndown config, so we assert on the
    // key facts rather than a byte-exact match.
    assert.true(
      response.text.includes('# Fallback Title'),
      `h1 converted to ATX heading: ${response.text}`,
    );
    assert.true(
      response.text.includes('Body paragraph.'),
      `paragraph body preserved: ${response.text}`,
    );
  });

  // Case 7: Override precedence
  test('subclass static markdown wins over the CardDef fallback', async function (assert) {
    let response = await request
      .get('/override')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.strictEqual(
      response.text.trim(),
      '# Right (authored)',
      `authored markdown wins: ${response.text}`,
    );
    assert.false(
      response.text.includes('Wrong'),
      `isolated HTML is NOT used: ${response.text}`,
    );
  });

  // Case 8: Explicit frontmatter
  test('YAML frontmatter authored in the template round-trips verbatim', async function (assert) {
    let response = await request
      .get('/frontmatter')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    let body = response.text.trim();
    // Frontmatter must lead (no auto-injection before it) and the closing
    // fence must precede the body.
    assert.true(
      body.startsWith('---'),
      `frontmatter leads the document: ${body}`,
    );
    assert.true(
      body.includes('title: Featured'),
      `frontmatter value preserved: ${body}`,
    );
    // Two `---` fences, then the body heading.
    let fenceCount = (body.match(/^---$/gm) ?? []).length;
    assert.strictEqual(fenceCount, 2, `exactly two --- fences: ${body}`);
    assert.true(body.includes('# Body'), `body follows frontmatter: ${body}`);
  });

  // Case 9: Nested card composition
  test('parent markdown embeds child card markdown via @fields', async function (assert) {
    let response = await request
      .get('/nested-parent')
      .set('Accept', SupportedMimeType.Markdown);

    assert.strictEqual(response.status, 200, 'HTTP 200 status');
    assert.true(
      response.text.includes('# Parent'),
      `parent heading present: ${response.text}`,
    );
    assert.true(
      response.text.includes('## Child'),
      `child heading present (embedded via @fields): ${response.text}`,
    );
  });

  // Case 11: Cache invalidation
  test('updating a card source and re-indexing changes the served markdown', async function (assert) {
    let first = await request
      .get('/cache')
      .set('Accept', SupportedMimeType.Markdown);
    assert.strictEqual(first.status, 200, 'initial HTTP 200');
    assert.true(
      first.text.includes('Version 1: Alpha'),
      `initial body reflects v1 template: ${first.text}`,
    );

    // Rewrite the card source and force a full reindex. `write` triggers an
    // incremental index for the instance; rewriting the module invalidates
    // its dependents. We await fullIndex to make assertions deterministic.
    await testRealm.write('cache.gts', CACHE_CARD_UPDATED_GTS);
    await testRealm.realmIndexUpdater.fullIndex();

    let second = await request
      .get('/cache')
      .set('Accept', SupportedMimeType.Markdown);
    assert.strictEqual(second.status, 200, 'post-update HTTP 200');
    assert.true(
      second.text.includes('Version 2: Alpha'),
      `post-update body reflects v2 template: ${second.text}`,
    );
    assert.false(
      second.text.includes('Version 1'),
      `no stale v1 text remains: ${second.text}`,
    );
  });
});
