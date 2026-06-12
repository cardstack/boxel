import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, type Loader } from '@cardstack/runtime-common';

import type * as AddressFieldModule from 'https://cardstack.com/base/address';
import type * as ColorFieldModule from 'https://cardstack.com/base/color';
import type * as CoordinateFieldModule from 'https://cardstack.com/base/coordinate';
import type * as CountryFieldModule from 'https://cardstack.com/base/country';
import type * as DateRangeFieldModule from 'https://cardstack.com/base/date-range-field';
import type * as LLMModelFieldModule from 'https://cardstack.com/base/llm-model';
import type * as PercentageFieldModule from 'https://cardstack.com/base/percentage';
import type * as UrlFieldModule from 'https://cardstack.com/base/url';
import type * as WebsiteFieldModule from 'https://cardstack.com/base/website';

import {
  BigIntegerField,
  BooleanField,
  CardDef,
  CodeRefField,
  Component,
  DateField,
  DateTimeField,
  EmailField,
  EthereumAddressField,
  PhoneNumberField,
  RichMarkdownField,
  contains,
  field,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

// Verifies the explicit `static markdown` templates added per CS-10786 to
// specialized fields. Each primitive/composite field renders through a
// CardDef wrapper whose `isolated` template invokes `<@fields.foo
// @format='markdown' />` placing the markdown output inside a
// `[data-test-md]` container we query for the text.

function readMarkdown(root: Element | Document): string {
  let el = root.querySelector('[data-test-md]');
  return (el?.textContent ?? '').trim();
}

module('Integration | field markdown specialized', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let AddressField: typeof AddressFieldModule.default;
  let ColorField: typeof ColorFieldModule.default;
  let CoordinateField: typeof CoordinateFieldModule.default;
  let CountryField: typeof CountryFieldModule.default;
  let DateRangeField: typeof DateRangeFieldModule.default;
  let LLMModelField: typeof LLMModelFieldModule.default;
  let PercentageField: typeof PercentageFieldModule.default;
  let UrlField: typeof UrlFieldModule.default;
  let WebsiteField: typeof WebsiteFieldModule.default;

  hooks.beforeEach(async function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    AddressField = (
      await loader.import<typeof AddressFieldModule>(`${baseRealm.url}address`)
    ).default;
    ColorField = (
      await loader.import<typeof ColorFieldModule>(`${baseRealm.url}color`)
    ).default;
    CoordinateField = (
      await loader.import<typeof CoordinateFieldModule>(
        `${baseRealm.url}coordinate`,
      )
    ).default;
    CountryField = (
      await loader.import<typeof CountryFieldModule>(`${baseRealm.url}country`)
    ).default;
    DateRangeField = (
      await loader.import<typeof DateRangeFieldModule>(
        `${baseRealm.url}date-range-field`,
      )
    ).default;
    LLMModelField = (
      await loader.import<typeof LLMModelFieldModule>(
        `${baseRealm.url}llm-model`,
      )
    ).default;
    PercentageField = (
      await loader.import<typeof PercentageFieldModule>(
        `${baseRealm.url}percentage`,
      )
    ).default;
    UrlField = (
      await loader.import<typeof UrlFieldModule>(`${baseRealm.url}url`)
    ).default;
    WebsiteField = (
      await loader.import<typeof WebsiteFieldModule>(`${baseRealm.url}website`)
    ).default;
  });

  // ---- Date family -----------------------------------------------------

  test('DateField markdown emits consistently-formatted escaped text', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(DateField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    // Construct a UTC midnight date that will format in en-US as a specific
    // day-month-year regardless of the runner's timezone by using a local
    // constructor that matches the shared formatter's assumptions.
    let card = new Sample({ value: new Date(2026, 3, 15) });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'Apr 15, 2026');
  });

  test('DateField markdown emits empty string for null/invalid', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(DateField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample();
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '');
  });

  test('DateTimeField markdown includes hour/minute', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(DateTimeField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: new Date(2026, 3, 15, 14, 30) });
    await renderCard(loader, card, 'isolated');
    // The shared en-US formatter with hour12 yields "Apr 15, 2026, 2:30 PM".
    // We just verify the date and time components are present and escaped
    // (commas aren't markdown metacharacters, so no escaping needed).
    let text = readMarkdown(this.element);
    assert.true(
      text.includes('Apr 15, 2026'),
      `expected date portion in: ${text}`,
    );
    assert.true(text.includes('2:30'), `expected time portion in: ${text}`);
  });

  test('DateRangeField markdown joins start/end with a dash', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(DateRangeField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new DateRangeField({
        start: new Date(2026, 3, 1),
        end: new Date(2026, 3, 30),
      }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      'Apr 1, 2026 - Apr 30, 2026',
    );
  });

  // ---- Simple scalars --------------------------------------------------

  test('BooleanField markdown emits the boolean literal', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(BooleanField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: true });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'true');
  });

  test('BigIntegerField markdown escapes leading minus sign', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(BigIntegerField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: -12345678901234567890n });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '\\-12345678901234567890');
  });

  test('PhoneNumberField markdown emits a tel: link when parseable', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(PhoneNumberField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: '+14155551234' });
    await renderCard(loader, card, 'isolated');
    let text = readMarkdown(this.element);
    assert.true(text.startsWith('['), `expected link open: ${text}`);
    assert.true(text.includes('](tel:'), `expected tel: href in link: ${text}`);
    assert.true(
      text.includes('+1 415'),
      `expected international formatted text: ${text}`,
    );
  });

  test('ColorField markdown escapes leading # heading marker', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(ColorField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: '#ff00ff' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '\\#ff00ff');
  });

  test('PercentageField markdown formats and escapes', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(PercentageField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 42.5 });
    await renderCard(loader, card, 'isolated');
    // `%` is not a markdown metacharacter, but the `42.` at line start
    // would look like an ordered-list marker, so `markdownEscape` emits
    // `42\.5%`.
    assert.strictEqual(readMarkdown(this.element), '42\\.5%');
  });

  test('CountryField markdown emits the country name', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(CountryField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new CountryField({ name: 'United States', code: 'US' }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'United States');
  });

  test('LLMModelField markdown prefers the display label', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(LLMModelField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    // An unknown id falls back to the id itself, escaped — the `-`
    // would otherwise read as a bullet marker at line start.
    let card = new Sample({ value: 'custom/model-id' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'custom/model\\-id');
  });

  test('EthereumAddressField markdown escapes its value', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(EthereumAddressField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: '0x0000000000000000000000000000000000000001',
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '0x0000000000000000000000000000000000000001',
    );
  });

  // ---- URL / link fields ----------------------------------------------

  test('EmailField markdown emits a mailto link', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(EmailField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'alice@example.com' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '[alice@example.com](mailto:alice@example.com)',
    );
  });

  test('UrlField markdown emits a bracketed link with encoded href', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(UrlField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'https://example.com/path with space' });
    await renderCard(loader, card, 'isolated');
    let text = readMarkdown(this.element);
    // href gets `%20` for the space; text escapes nothing since `/`, `:`
    // aren't metacharacters.
    assert.strictEqual(
      text,
      '[https://example.com/path with space](https://example.com/path%20with%20space)',
    );
  });

  test('UrlField markdown falls back to escaped text for invalid URL', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(UrlField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'not a *url*' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), 'not a \\*url\\*');
  });

  test('WebsiteField markdown shows domain/path text with full-URL href', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(WebsiteField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({ value: 'https://example.com/docs/api' });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '[example.com/docs/api](https://example.com/docs/api)',
    );
  });

  // ---- Composite fields -----------------------------------------------

  test('AddressField markdown renders rows with hard breaks', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(AddressField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new AddressField({
        addressLine1: '123 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
      }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '123 Main St  \nSpringfield, IL, 62701',
    );
  });

  test('CoordinateField markdown formats (x, y) with escaped components', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(CoordinateField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new CoordinateField({ x: -1.5, y: 2 }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '(\\-1.5, 2)');
  });

  test('CodeRefField markdown emits an inline code span', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(CodeRefField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: { module: '@cardstack/base/string', name: 'default' },
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(
      readMarkdown(this.element),
      '`@cardstack/base/string/default`',
    );
  });

  test('RichMarkdownField markdown passes content through unescaped', async function (this: RenderingTestContext, assert) {
    class Sample extends CardDef {
      @field value = contains(RichMarkdownField);
      static isolated = class extends Component<typeof this> {
        <template>
          <div data-test-md><@fields.value @format='markdown' /></div>
        </template>
      };
    }
    let card = new Sample({
      value: new RichMarkdownField({ content: '# Heading\n\n- item' }),
    });
    await renderCard(loader, card, 'isolated');
    assert.strictEqual(readMarkdown(this.element), '# Heading\n\n- item');
  });
});
