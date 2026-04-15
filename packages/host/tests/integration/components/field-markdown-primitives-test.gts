import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  CardDef,
  Component,
  CSSField,
  contains,
  field,
  MarkdownField,
  MaybeBase64Field,
  NumberField,
  ReadOnlyField,
  setupBaseRealm,
  StringField,
  TextAreaField,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// Verifies the default `static markdown` templates for primitive fields
// (CS-10785). Each primitive renders through a CardDef wrapper whose
// `isolated` template invokes `<@fields.foo @format='markdown' />`, placing
// the markdown output inside a `[data-test-md]` container we query for the
// text.

function readMarkdown(root: Element | Document): string {
  let el = root.querySelector('[data-test-md]');
  return (el?.textContent ?? '').trim();
}

module('Integration | field markdown primitives', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  test('StringField markdown escapes metacharacters', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(StringField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ value: 'Hello *world* [link]' });
    await renderCard(loader, card, 'isolated');

    // markdownEscape backslash-escapes `*`, `[`, and `]`.
    assert.strictEqual(
      readMarkdown(this.element),
      'Hello \\*world\\* \\[link\\]',
    );
  });

  test('StringField markdown handles null/undefined gracefully', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(StringField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    // No value set — field resolves to undefined/null; markdownEscape emits ''.
    let card = new Sample();
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('ReadOnlyField markdown escapes metacharacters', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(ReadOnlyField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample();
    // ReadOnlyField is computed/assigned by the serializer normally; set via
    // @field only to drive the template. `1.` at line-start would normally
    // read as an ordered list marker — the escape prevents that.
    (card as any).value = '1. Item';
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '1\\. Item');
  });

  test('NumberField markdown emits the number as text', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(NumberField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ value: 42 });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '42');
  });

  test('NumberField markdown handles negative and decimal values', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(NumberField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    // `-3.14` → leading `-` would look like a bullet marker at line start;
    // `3.` would look like an ordered list prefix. markdownEscape handles
    // both: `-` becomes `\-`, and `3.` at line start becomes `3\.`.
    let card = new Sample({ value: -3.14 });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '\\-3\\.14');
  });

  test('TextAreaField markdown preserves line breaks as CommonMark hard breaks', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(TextAreaField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ value: 'Line 1\nLine 2\nLine 3' });
    await renderCard(loader, card, 'isolated');

    let el = this.element.querySelector('[data-test-md]');
    // Use raw textContent (not trim/collapse) so we can inspect whitespace.
    let raw = el?.textContent ?? '';
    assert.strictEqual(raw, 'Line 1  \nLine 2  \nLine 3');
  });

  test('TextAreaField markdown escapes metacharacters per line', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(TextAreaField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ value: '# not a heading\n* not a bullet' });
    await renderCard(loader, card, 'isolated');
    let el = this.element.querySelector('[data-test-md]');
    let raw = el?.textContent ?? '';
    assert.strictEqual(raw, '\\# not a heading  \n\\* not a bullet');
  });

  test('MarkdownField passes through content unescaped', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(MarkdownField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }

    // The author's markdown must survive interpolation unchanged — no double
    // escaping. Downstream consumers render it as markdown.
    let card = new Sample({ value: '# Heading\n\n- item 1\n- item 2' });
    await renderCard(loader, card, 'isolated');
    let el = this.element.querySelector('[data-test-md]');
    let raw = el?.textContent ?? '';
    assert.strictEqual(raw, '# Heading\n\n- item 1\n- item 2');
  });

  test('CSSField markdown emits a fenced code block with css info-string', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field styles = contains(CSSField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.styles @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ styles: '.foo { color: red; }' });
    await renderCard(loader, card, 'isolated');
    let el = this.element.querySelector('[data-test-md]');
    let raw = el?.textContent ?? '';
    assert.strictEqual(raw, '```css\n.foo { color: red; }\n```');
  });

  test('CSSField markdown extends the fence when content contains triple backticks', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field styles = contains(CSSField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.styles @format='markdown' /></div>
        </template>
      };
    }

    // Pathological input: a comment with the literal fence sequence. The
    // emitter bumps the fence width so the block is still syntactically
    // well-formed.
    let weird = '/* ' + '`'.repeat(3) + ' */';
    let card = new Sample({ styles: weird });
    await renderCard(loader, card, 'isolated');
    let el = this.element.querySelector('[data-test-md]');
    let raw = el?.textContent ?? '';
    let fence = '`'.repeat(4);
    assert.strictEqual(raw, `${fence}css\n${weird}\n${fence}`);
  });

  test('MaybeBase64Field markdown emits placeholder for data: URIs', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field thumbnail = contains(MaybeBase64Field);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.thumbnail @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({
      thumbnail: 'data:image/png;base64,iVBORw0KGgoAAAANSU',
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '[binary content]');
  });

  test('MaybeBase64Field markdown falls back to escaped text for non-base64 values', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field thumbnail = contains(MaybeBase64Field);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.thumbnail @format='markdown' /></div>
        </template>
      };
    }

    let card = new Sample({ thumbnail: 'https://example.com/a*b.png' });
    await renderCard(loader, card, 'isolated');
    // `*` is escaped; `https://...` is left as-is (`:` and `/` are not
    // markdown metacharacters).
    assert.strictEqual(
      readMarkdown(this.element),
      'https://example.com/a\\*b.png',
    );
  });

  test('all primitives compose into a single markdown document', async function (this: RenderingTestContext, assert) {
    class Everything extends CardDef {
      @field name = contains(StringField);
      @field count = contains(NumberField);
      @field notes = contains(TextAreaField);
      @field body = contains(MarkdownField);
      @field styles = contains(CSSField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md>
            Name:
            <@fields.name @format='markdown' />
            Count:
            <@fields.count @format='markdown' />
            Notes:
            <@fields.notes @format='markdown' />
            Body:
            <@fields.body @format='markdown' />
            CSS:
            <@fields.styles @format='markdown' />
          </div>
        </template>
      };
    }

    let card = new Everything({
      name: 'Widget *v1*',
      count: 7,
      notes: 'line 1\nline 2',
      body: '**bold** value',
      styles: 'a { color: red }',
    });
    await renderCard(loader, card, 'isolated');

    let el = this.element.querySelector('[data-test-md]');
    let raw = el?.textContent ?? '';
    // Ensure each field's characteristic output appears. Whitespace between
    // labels is template-driven and not meaningful — the key thing is that
    // each primitive rendered its markdown rather than its HTML template.
    assert.ok(raw.includes('Widget \\*v1\\*'), `StringField escape: ${raw}`);
    assert.ok(raw.includes('7'), `NumberField value: ${raw}`);
    assert.ok(raw.includes('line 1  \nline 2'), `TextArea hard-break: ${raw}`);
    assert.ok(
      raw.includes('**bold** value'),
      `MarkdownField passthrough: ${raw}`,
    );
    assert.ok(
      raw.includes('```css\na { color: red }\n```'),
      `CSSField fenced block: ${raw}`,
    );
  });
});
