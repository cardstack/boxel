import type { RenderingTestContext } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import { cleanWhiteSpace } from '../../helpers';
import {
  CardDef,
  Component,
  contains,
  field,
  FieldDef,
  setupBaseRealm,
  StringField,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// Verifies the default `static markdown` fallback wired into CardDef/FieldDef/
// FileDef (CS-10784). The fallback renders the HTML embedded/isolated template
// into a hidden source container and converts it to markdown via the
// `globalThis.__boxelHtmlToMarkdown` function registered by
// `packages/host/app/instance-initializers/register-html-to-markdown.ts`. The
// resulting markdown is emitted into `[data-markdown-output]`, which is what
// the prerender pipeline targets for textContent capture.

async function renderAndConvert(loader: Loader, card: any) {
  await renderCard(loader, card, 'markdown');
  // The capture modifier defers conversion to `scheduleOnce('afterRender')`
  // and then mutates `@tracked markdown`, triggering a follow-up render.
  // `renderCard` awaits an initial settle, but we need one more tick for the
  // modifier-triggered re-render to land in the DOM.
  await settled();
}

function readMarkdownOutput(): string {
  let el = document.querySelector('[data-markdown-output]');
  return cleanWhiteSpace(el?.textContent ?? '');
}

module('Integration | markdown-fallback', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  test('CardDef default fallback converts HTML headings to ATX markdown', async function (assert) {
    class Article extends CardDef {
      @field title = contains(StringField);
      static isolated = class extends Component<typeof this> {
        <template>
          <h1>{{@model.title}}</h1>
          <h2>Subtitle</h2>
          <p>Body paragraph.</p>
        </template>
      };
    }

    let card = new Article({ title: 'Hello' });
    await renderAndConvert(loader, card);

    let md = readMarkdownOutput();
    assert.true(md.includes('# Hello'), `expected '# Hello' in: ${md}`);
    assert.true(md.includes('## Subtitle'), `expected '## Subtitle' in: ${md}`);
    assert.true(
      md.includes('Body paragraph.'),
      `expected 'Body paragraph.' in: ${md}`,
    );
  });

  test('CardDef default fallback converts unordered & ordered lists', async function (assert) {
    class List extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <ul>
            <li>alpha</li>
            <li>beta</li>
          </ul>
          <ol>
            <li>one</li>
            <li>two</li>
          </ol>
        </template>
      };
    }

    let card = new List();
    await renderAndConvert(loader, card);
    let md = readMarkdownOutput();

    // bulletListMarker is configured as `-`.
    assert.true(md.includes('- alpha'), `expected '- alpha' in: ${md}`);
    assert.true(md.includes('- beta'), `expected '- beta' in: ${md}`);
    assert.true(md.includes('1. one'), `expected '1. one' in: ${md}`);
    assert.true(md.includes('2. two'), `expected '2. two' in: ${md}`);
  });

  test('CardDef default fallback converts links and inline code', async function (assert) {
    class Link extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <p>See
            <a href='https://example.com'>example</a>
            and use
            <code>npm install</code>.</p>
        </template>
      };
    }

    let card = new Link();
    await renderAndConvert(loader, card);
    let md = readMarkdownOutput();

    assert.true(
      md.includes('[example](https://example.com)'),
      `expected inlined link in: ${md}`,
    );
    assert.true(
      md.includes('`npm install`'),
      `expected backtick inline code in: ${md}`,
    );
  });

  test('CardDef default fallback collapses whitespace in link text from nested elements', async function (assert) {
    // Card HTML often wraps link text in icon spans + text nodes with newlines
    // between them.  Turndown would preserve those newlines, producing broken
    // multiline `[\n  Contact](url)` markdown.  The compactLinks rule collapses
    // whitespace so links render correctly.
    class ContactCard extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <a href='mailto:alice@example.com'>
            <span class='icon'>📧</span>
            Contact
          </a>
          <a href='https://x.com/alice'>
            <span class='icon'>🐦</span>
            Follow
          </a>
        </template>
      };
    }

    let card = new ContactCard();
    await renderAndConvert(loader, card);
    let md = readMarkdownOutput();

    assert.true(
      md.includes('[📧 Contact](mailto:alice@example.com)'),
      `expected collapsed link text in: ${md}`,
    );
    assert.true(
      md.includes('[🐦 Follow](https://x.com/alice)'),
      `expected collapsed follow link in: ${md}`,
    );
  });

  test('CardDef default fallback converts <pre><code> to fenced code blocks', async function (assert) {
    class Snippet extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <pre><code class='language-js'>let x = 1;</code></pre>
        </template>
      };
    }

    let card = new Snippet();
    await renderAndConvert(loader, card);
    let md = readMarkdownOutput();

    // codeBlockStyle: 'fenced' — turndown emits triple-backtick fences. The
    // `language-js` class becomes the fence info-string.
    assert.true(md.includes('```'), `expected fenced code in: ${md}`);
    assert.true(md.includes('let x = 1;'), `expected code body in: ${md}`);
  });

  test('CardDef subclass override of `static markdown` wins over the fallback', async function (this: RenderingTestContext, assert) {
    class Custom extends CardDef {
      @field title = contains(StringField);
      static isolated = class extends Component<typeof this> {
        <template>
          <h1>HTML title would convert to # but should NOT be used</h1>
        </template>
      };
      // Authoring markdown directly — no HTML conversion involved. The
      // fallback's hidden source container should not appear in the output.
      static markdown = class extends Component<typeof this> {
        <template># {{@model.title}} (authored)</template>
      };
    }

    let card = new Custom({ title: 'Override' });
    await renderCard(loader, card, 'markdown');

    // No fallback container should be present when the subclass overrides.
    assert
      .dom('[data-markdown-fallback-source]')
      .doesNotExist('fallback source container should not render');
    assert
      .dom('[data-markdown-output]')
      .doesNotExist('fallback output container should not render');

    // The render route wraps format='markdown' in [data-markdown-render-container],
    // but that wrapper is route-only (packages/host/app/templates/render/html.gts).
    // In rendering tests we query the root test element directly — the authored
    // markdown is the only text content in the render.
    let text = cleanWhiteSpace(this.element.textContent ?? '');
    assert.strictEqual(text, '# Override (authored)');
  });

  test('FieldDef default fallback converts the embedded template to markdown', async function (assert) {
    // FieldDef has no `isolated` slot — only `embedded`. The fallback picks
    // the right slot dynamically based on `cls.isFieldDef`, so the embedded
    // HTML is what gets converted.
    class Greeting extends FieldDef {
      @field name = contains(StringField);
      static embedded = class extends Component<typeof this> {
        <template>
          <strong>Hello, {{@model.name}}!</strong>
        </template>
      };
    }

    class Wrapper extends CardDef {
      @field greeting = contains(Greeting);
      static isolated = class extends Component<typeof this> {
        <template><@fields.greeting @format='markdown' /></template>
      };
    }

    let card = new Wrapper({ greeting: new Greeting({ name: 'World' }) });
    // Render the wrapper at isolated; the inner @fields.greeting is rendered
    // at markdown via the explicit @format prop, exercising the FieldDef
    // fallback path.
    await renderCard(loader, card, 'isolated');
    await settled();

    let md = readMarkdownOutput();
    // strongDelimiter is configured as `**`.
    assert.true(
      md.includes('**Hello, World!**'),
      `expected bolded greeting in: ${md}`,
    );
  });

  test('default fallback exposes data-markdown-output for prerender capture', async function (assert) {
    class Simple extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <p>plain text</p>
        </template>
      };
    }

    let card = new Simple();
    await renderAndConvert(loader, card);

    assert
      .dom('[data-markdown-output]')
      .exists('the prerender textContent target is present');
    // The hidden source container should also exist (modifier reads from it),
    // and `display: none` keeps it out of the visual layout — but `textContent`
    // would still include its text, which is exactly why the prerender pipeline
    // queries `[data-markdown-output]` specifically (see prerender/utils.ts).
    assert
      .dom('[data-markdown-fallback-source]')
      .exists('hidden source container is present for the modifier to read');
  });

  test('default fallback strips style and script elements from markdown output', async function (assert) {
    class StyledCard extends CardDef {
      static isolated = class extends Component<typeof this> {
        <template>
          <style>
            .foo { color: red; }
          </style>
          <p>visible content</p>
        </template>
      };
    }

    let card = new StyledCard();
    await renderAndConvert(loader, card);

    let md = readMarkdownOutput();
    assert.true(
      md.includes('visible content'),
      `expected visible content in: ${md}`,
    );
    assert.false(
      md.includes('.foo'),
      `CSS should be stripped from markdown: ${md}`,
    );
    assert.false(
      md.includes('color: red'),
      `CSS rules should be stripped from markdown: ${md}`,
    );
  });
});
