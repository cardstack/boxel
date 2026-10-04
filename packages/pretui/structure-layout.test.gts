// Pretui — render + semantics proof for Stack, Card, Collapsible, AspectRatio
// and cssUrl.
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// Nothing here asserts a computed style. `boxel test` stamps the scoped-CSS
// attribute and delivers no stylesheet, so every colour, size and layout value
// reads as its initial value in this harness. What is asserted instead is what
// the components actually control: reflected data attributes, ARIA wiring,
// element identity, DOM order, emitted callbacks, and the inputs to CSS (the
// style attribute and its custom properties).
import { module, test } from 'qunit';
import { click, render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { AspectBox, AspectRatio, cssUrl } from './components/aspect-ratio';
import { Card } from './components/card';
import { Collapsible } from './components/collapsible';
import { Stack } from './components/stack';
import { StackDivider } from './components/stack-divider';
import { pretuiOrientation, pretuiSize } from './internal/structure-layout';

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

/** True when `b` follows `a` in document order.
 *
 * The bit is named locally rather than read from
 * `Node.DOCUMENT_POSITION_FOLLOWING`: in the `boxel test` harness that constant
 * reads as `undefined`, and `4 & undefined` is `0`, so the assertion fails for
 * a reason that has nothing to do with the DOM. */
const DOCUMENT_POSITION_FOLLOWING = 4;
function precedes(a: Element | null, b: Element | null): boolean {
  if (!a || !b) {
    return false;
  }
  return (
    (a.compareDocumentPosition(b) & DOCUMENT_POSITION_FOLLOWING) ===
    DOCUMENT_POSITION_FOLLOWING
  );
}

interface Row {
  id: string;
  label: string;
}

const ROWS: Row[] = [
  { id: 'a', label: 'Alpha' },
  { id: 'b', label: 'Bravo' },
  { id: 'c', label: 'Charlie' },
];

// A one-pixel transparent GIF, inline so nothing reaches the network.
const PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// ── the alias resolvers ──────────────────────────────────────────────────

module('Pretui | structure-layout | alias resolvers', function () {
  test('every accepted size spelling resolves to the house enum', function (assert) {
    assert.strictEqual(pretuiSize('sm'), 's', 'sm resolves');
    assert.strictEqual(pretuiSize('md'), 'm', 'md resolves');
    assert.strictEqual(pretuiSize('lg'), 'l', 'lg resolves');
    assert.strictEqual(pretuiSize('default'), 'm', 'default resolves to m');
    assert.strictEqual(pretuiSize('xl'), 'xl', 'the house name passes through');
    assert.strictEqual(pretuiSize(undefined), 'm', 'undefined takes the fallback');
    assert.strictEqual(
      pretuiSize('nonsense'),
      'm',
      'an unknown spelling falls back rather than reaching the DOM',
    );
    assert.strictEqual(
      pretuiSize(''),
      'm',
      'the empty string falls back — the bug an && chain would ship',
    );
  });

  test('orientation accepts direction, row and column', function (assert) {
    assert.strictEqual(
      pretuiOrientation('horizontal', undefined, 'vertical'),
      'horizontal',
    );
    assert.strictEqual(
      pretuiOrientation(undefined, 'row', 'vertical'),
      'horizontal',
      'the direction alias resolves',
    );
    assert.strictEqual(
      pretuiOrientation(undefined, 'column', 'horizontal'),
      'vertical',
    );
    assert.strictEqual(
      pretuiOrientation('vertical', 'row', 'horizontal'),
      'vertical',
      'the canonical arg wins over the alias',
    );
    assert.strictEqual(
      pretuiOrientation(undefined, undefined, 'horizontal'),
      'horizontal',
    );
  });
});

// ── cssUrl ───────────────────────────────────────────────────────────────

module('Pretui | structure-layout | cssUrl', function () {
  test('admits only image URLs on the protocol allowlist', function (assert) {
    assert.strictEqual(
      cssUrl('https://example.test/a.jpg'),
      'url("https://example.test/a.jpg")',
      'https is admitted and quoted',
    );
    assert.strictEqual(
      cssUrl('/photos/a.jpg'),
      'url("/photos/a.jpg")',
      'a relative path resolves against the base and is admitted',
    );
    assert.strictEqual(
      cssUrl(PIXEL),
      'url("' + PIXEL + '")',
      'a data image URI is admitted',
    );
  });

  test('rejects every escape route rather than sanitising one', function (assert) {
    assert.strictEqual(
      cssUrl('javascript:alert(1)'),
      undefined,
      'a script protocol is rejected',
    );
    assert.strictEqual(
      cssUrl('data:text/html,<script>'),
      undefined,
      'a non-image data URI is rejected',
    );
    assert.strictEqual(
      cssUrl('a.jpg"); background: red; x: url("b'),
      undefined,
      'a quote that would close the url token is rejected',
    );
    assert.strictEqual(
      cssUrl('a.jpg) ; color: red'),
      undefined,
      'a paren that would close the url token is rejected',
    );
    assert.strictEqual(cssUrl('file:///etc/passwd'), undefined, 'file is rejected');
    assert.strictEqual(cssUrl(''), undefined, 'empty is rejected');
    assert.strictEqual(cssUrl(undefined), undefined, 'undefined is rejected');
    assert.strictEqual(cssUrl(42), undefined, 'a non-string is rejected');
  });
});

// ── Stack ────────────────────────────────────────────────────────────────

module('Pretui | structure-layout | Stack', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('reflects the resolved axes, including through the aliases', async function (assert) {
    await render(
      <template>
        <Stack @direction='row' @gap='lg' @justify='between' @wrap={{true}}>
          <span>one</span>
        </Stack>
      </template>,
    );
    let el = root().querySelector('[data-test-pretui-stack]');
    assert.ok(el, 'the stack renders');
    assert.strictEqual(
      el?.getAttribute('data-orientation'),
      'horizontal',
      'direction=row resolves to the house orientation',
    );
    assert.strictEqual(
      el?.getAttribute('data-gap'),
      'l',
      'gap=lg resolves to the house size',
    );
    assert.strictEqual(el?.getAttribute('data-justify'), 'between');
    assert.strictEqual(el?.getAttribute('data-wrap'), 'true');
    assert.strictEqual(
      el?.getAttribute('data-align'),
      'center',
      'a horizontal stack defaults to center, not stretch',
    );
  });

  test('a vertical stack defaults to stretch', async function (assert) {
    await render(
      <template><Stack><span>one</span></Stack></template>,
    );
    let el = root().querySelector('[data-test-pretui-stack]');
    assert.strictEqual(el?.getAttribute('data-orientation'), 'vertical');
    assert.strictEqual(el?.getAttribute('data-align'), 'stretch');
    assert.strictEqual(el?.getAttribute('data-gap'), 'm');
  });

  test('the items form authors one cell per item and n-1 rules', async function (assert) {
    await render(
      <template>
        <Stack @items={{ROWS}} @dividers={{true}}>
          <:item as |row|><span class='t-label'>{{row.label}}</span></:item>
        </Stack>
      </template>,
    );
    let el = root().querySelector('[data-test-pretui-stack]');
    let cells = el?.querySelectorAll('.pretui-stack-cell') ?? [];
    let rules = el?.querySelectorAll('.pretui-stack-rule') ?? [];
    assert.strictEqual(cells.length, 3, 'one cell per item');
    assert.strictEqual(
      rules.length,
      2,
      'n-1 rules — never a dangling one after the last item',
    );
    assert.strictEqual(
      root().querySelectorAll('.t-label').length,
      3,
      'every item block rendered',
    );
    for (let rule of Array.from(rules)) {
      assert.strictEqual(
        rule.getAttribute('aria-hidden'),
        'true',
        'a layout rule is decorative and stays out of the tree',
      );
      assert.notOk(
        rule.getAttribute('role'),
        'and carries no separator role, which would be a landmark for a hairline',
      );
    }
  });

  test('items renders rules interleaved, not clustered', async function (assert) {
    await render(
      <template>
        <Stack @items={{ROWS}} @dividers={{true}}>
          <:item as |row|><span class='t-label'>{{row.label}}</span></:item>
        </Stack>
      </template>,
    );
    let cells = root().querySelectorAll('.pretui-stack-cell');
    let rules = root().querySelectorAll('.pretui-stack-rule');
    assert.ok(
      precedes(cells[0] as Element, rules[0] as Element),
      'the first rule follows the first cell',
    );
    assert.ok(
      precedes(rules[0] as Element, cells[1] as Element),
      'and precedes the second cell',
    );
  });

  test('dividers off means no rules at all', async function (assert) {
    await render(
      <template>
        <Stack @items={{ROWS}}>
          <:item as |row|><span>{{row.label}}</span></:item>
        </Stack>
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('.pretui-stack-rule').length,
      0,
      'no rules without the flag',
    );
    assert.strictEqual(
      root().querySelector('[data-test-pretui-stack]')?.getAttribute(
        'data-dividers',
      ),
      'false',
      'and the state is reflected either way',
    );
  });

  test('the plain form authors no cells, so nothing is silently wrapped', async function (assert) {
    await render(
      <template>
        <Stack @dividers={{true}}><span class='t-child'>one</span></Stack>
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('.pretui-stack-cell').length,
      0,
      'a free-form child is not wrapped in a cell',
    );
    assert.strictEqual(
      root().querySelectorAll('.pretui-stack-rule').length,
      0,
      'and dividers are inert in this form, as the docs say',
    );
    assert.ok(root().querySelector('.t-child'), 'the child still renders');
  });

  test('...attributes reaches the root and is never swallowed', async function (assert) {
    await render(
      <template><Stack id='outer' class='mine'><span>x</span></Stack></template>,
    );
    let el = root().querySelector('[data-test-pretui-stack]');
    assert.strictEqual(el?.getAttribute('id'), 'outer', 'a native id passes through');
    assert.ok(
      el?.classList.contains('mine'),
      'and a caller class composes with the component class',
    );
    assert.ok(
      el?.classList.contains('pretui-stack'),
      'without displacing it',
    );
  });

  test('StackDivider is decorative by default and semantic on request', async function (assert) {
    await render(
      <template>
        <StackDivider />
        <StackDivider @semantic={{true}} @orientation='horizontal' />
      </template>,
    );
    let all = root().querySelectorAll('[data-test-pretui-stack-divider]');
    assert.strictEqual(all.length, 2, 'both render');
    assert.strictEqual(all[0]?.getAttribute('aria-hidden'), 'true');
    assert.notOk(all[0]?.getAttribute('role'), 'decorative carries no role');
    assert.strictEqual(all[1]?.getAttribute('role'), 'separator');
    assert.strictEqual(all[1]?.getAttribute('aria-orientation'), 'horizontal');
    assert.notOk(
      all[1]?.getAttribute('aria-hidden'),
      'a semantic separator is not hidden from the tree',
    );
  });
});

// ── Card ─────────────────────────────────────────────────────────────────

module('Pretui | structure-layout | Card', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('a title becomes a real heading and names the region', async function (assert) {
    await render(
      <template>
        <Card @title='Lot B-201' @description='First flush'>
          <:default><p>body</p></:default>
        </Card>
      </template>,
    );
    let card = root().querySelector('[data-test-pretui-card]');
    let heading = card?.querySelector('h3');
    assert.ok(heading, 'the title is an h3, not a div with a bold class');
    assert.strictEqual(heading?.textContent?.trim(), 'Lot B-201');
    assert.ok(heading?.id, 'the heading carries an id');
    assert.strictEqual(
      card?.getAttribute('aria-labelledby'),
      heading?.id,
      'and the section is labelled by it, so the card is a named region',
    );
    assert.strictEqual(card?.tagName, 'SECTION');
  });

  test('no title means no dangling label reference', async function (assert) {
    await render(
      <template><Card><p>body only</p></Card></template>,
    );
    let card = root().querySelector('[data-test-pretui-card]');
    assert.notOk(
      card?.getAttribute('aria-labelledby'),
      'an unnamed card adds nothing to the rotor',
    );
    assert.strictEqual(card?.querySelectorAll('h3').length, 0, 'and no heading');
  });

  test('a header block replaces the generated header and its naming', async function (assert) {
    await render(
      <template>
        <Card @title='Ignored'>
          <:header><h2 class='t-own'>Mine</h2></:header>
          <:default><p>body</p></:default>
        </Card>
      </template>,
    );
    let card = root().querySelector('[data-test-pretui-card]');
    assert.ok(root().querySelector('.t-own'), 'the caller header renders');
    assert.strictEqual(
      card?.querySelectorAll('h3').length,
      0,
      'the generated heading is gone',
    );
    assert.notOk(
      card?.getAttribute('aria-labelledby'),
      'and naming is handed back to the caller rather than pointing at nothing',
    );
  });

  test('the header grid gains its second column only when an action exists', async function (assert) {
    await render(
      <template>
        <Card @title='With'>
          <:action><button type='button' class='t-act'>Edit</button></:action>
          <:default><p>body</p></:default>
        </Card>
        <Card @title='Without'>
          <:default><p>body</p></:default>
        </Card>
      </template>,
    );
    let headers = root().querySelectorAll('.pretui-card-header');
    assert.strictEqual(headers.length, 2, 'both headers render');
    assert.strictEqual(
      headers[0]?.getAttribute('data-has-action'),
      'true',
      'the component knows the block was passed — no :has() probe',
    );
    assert.strictEqual(headers[1]?.getAttribute('data-has-action'), 'false');
    assert.ok(root().querySelector('.t-act'), 'the action renders');
  });

  test('reflects tone, appearance, size and orientation, resolving aliases', async function (assert) {
    await render(
      <template>
        <Card
          @title='X'
          @tone='danger'
          @appearance='filled'
          @size='lg'
          @direction='row'
          @interactive={{true}}
        >
          <:default><p>body</p></:default>
        </Card>
      </template>,
    );
    let card = root().querySelector('[data-test-pretui-card]');
    assert.strictEqual(card?.getAttribute('data-tone'), 'danger');
    assert.strictEqual(card?.getAttribute('data-appearance'), 'filled');
    assert.strictEqual(
      card?.getAttribute('data-size'),
      'l',
      'size=lg resolves to the house enum',
    );
    assert.strictEqual(
      card?.getAttribute('data-orientation'),
      'horizontal',
      'direction=row resolves',
    );
    assert.strictEqual(card?.getAttribute('data-interactive'), 'true');
  });

  test('regions render in source order: media, header, body, footer', async function (assert) {
    await render(
      <template>
        <Card @title='Ordered'>
          <:media><span class='t-media'>m</span></:media>
          <:default><p class='t-body'>b</p></:default>
          <:footer><span class='t-foot'>f</span></:footer>
        </Card>
      </template>,
    );
    let media = root().querySelector('.t-media');
    let header = root().querySelector('.pretui-card-header');
    let body = root().querySelector('.t-body');
    let foot = root().querySelector('.t-foot');
    assert.ok(precedes(media, header), 'media precedes the header');
    assert.ok(precedes(header, body), 'the header precedes the body');
    assert.ok(precedes(body, foot), 'the body precedes the footer');
  });
});

// ── Collapsible ──────────────────────────────────────────────────────────

module('Pretui | structure-layout | Collapsible', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('the trigger and region are wired both ways, closed included', async function (assert) {
    await render(
      <template>
        <Collapsible @label='Advanced'><p>inner</p></Collapsible>
      </template>,
    );
    let trigger = root().querySelector('[data-test-pretui-collapsible-trigger]');
    let content = root().querySelector('[data-test-pretui-collapsible-content]');
    assert.ok(trigger && content, 'both render');
    assert.strictEqual(
      trigger?.getAttribute('aria-expanded'),
      'false',
      'closed is stated, not implied',
    );
    assert.strictEqual(
      trigger?.getAttribute('aria-controls'),
      content?.id,
      'aria-controls resolves WHILE CLOSED — Radix drops it, because its content is hidden and this one is not',
    );
    assert.strictEqual(content?.getAttribute('role'), 'region');
    assert.strictEqual(
      content?.getAttribute('aria-labelledby'),
      trigger?.id,
      'and the region is named by its trigger',
    );
    assert.strictEqual(
      (trigger as HTMLButtonElement).type,
      'button',
      'never a submit button inside a form',
    );
  });

  test('uncontrolled: a click toggles state and fires the callback', async function (assert) {
    let seen: boolean[] = [];
    let record = (next: boolean) => seen.push(next);
    await render(
      <template>
        <Collapsible @label='Advanced' @onOpenChange={{record}}>
          <p>inner</p>
        </Collapsible>
      </template>,
    );
    let box = root().querySelector('[data-test-pretui-collapsible]');
    await click('[data-test-pretui-collapsible-trigger]');
    assert.strictEqual(box?.getAttribute('data-state'), 'open');
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-collapsible-trigger]')
        ?.getAttribute('aria-expanded'),
      'true',
    );
    await click('[data-test-pretui-collapsible-trigger]');
    assert.strictEqual(box?.getAttribute('data-state'), 'closed');
    assert.deepEqual(seen, [true, false], 'the callback carries the next state');
  });

  test('defaultOpen seeds the uncontrolled half', async function (assert) {
    await render(
      <template>
        <Collapsible @label='Advanced' @defaultOpen={{true}}><p>x</p></Collapsible>
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-collapsible]')
        ?.getAttribute('data-state'),
      'open',
    );
  });

  test('controlled: the component never moves itself, but always reports', async function (assert) {
    let seen: boolean[] = [];
    let record = (next: boolean) => seen.push(next);
    await render(
      <template>
        <Collapsible @label='Advanced' @open={{false}} @onOpenChange={{record}}>
          <p>inner</p>
        </Collapsible>
      </template>,
    );
    await click('[data-test-pretui-collapsible-trigger]');
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-collapsible]')
        ?.getAttribute('data-state'),
      'closed',
      'a controlled component obeys the arg, not the click',
    );
    assert.deepEqual(seen, [true], 'and still tells the parent what was asked');
  });

  test('disabled stays focusable and refuses to act', async function (assert) {
    let seen: boolean[] = [];
    let record = (next: boolean) => seen.push(next);
    await render(
      <template>
        <Collapsible @label='Advanced' @disabled={{true}} @onOpenChange={{record}}>
          <p>inner</p>
        </Collapsible>
      </template>,
    );
    let trigger = root().querySelector(
      '[data-test-pretui-collapsible-trigger]',
    ) as HTMLButtonElement;
    assert.strictEqual(trigger.getAttribute('aria-disabled'), 'true');
    assert.notOk(
      trigger.hasAttribute('disabled'),
      'never the native attribute — a control that leaves the tab order vanished',
    );
    await click('[data-test-pretui-collapsible-trigger]');
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-collapsible]')
        ?.getAttribute('data-state'),
      'closed',
      'the click did nothing',
    );
    assert.deepEqual(seen, [], 'and nothing was reported');
  });

  test('the content is mounted while closed, so state survives a toggle', async function (assert) {
    await render(
      <template>
        <Collapsible @label='Advanced'>
          <input class='t-field' aria-label='Note' />
        </Collapsible>
      </template>,
    );
    let field = root().querySelector('.t-field') as HTMLInputElement;
    assert.ok(field, 'the content exists in the DOM while closed');
    field.value = 'kept';
    await click('[data-test-pretui-collapsible-trigger]');
    await click('[data-test-pretui-collapsible-trigger]');
    assert.strictEqual(
      (root().querySelector('.t-field') as HTMLInputElement).value,
      'kept',
      'and is the same element after a round trip — never remounted',
    );
  });

  test('the trigger block wins over the label and is yielded the state', async function (assert) {
    await render(
      <template>
        <Collapsible @label='Ignored' @defaultOpen={{true}}>
          <:trigger as |isOpen|><span class='t-trig'>{{if isOpen 'Hide' 'Show'}}</span></:trigger>
          <:default><p>x</p></:default>
        </Collapsible>
      </template>,
    );
    assert.strictEqual(
      root().querySelector('.t-trig')?.textContent?.trim(),
      'Hide',
      'the block sees the open state',
    );
  });

  test('hideCaret removes the indicator', async function (assert) {
    await render(
      <template>
        <Collapsible @label='A' @hideCaret={{true}}><p>x</p></Collapsible>
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('.pretui-collapsible-caret').length,
      0,
    );
  });
});

// ── AspectRatio ──────────────────────────────────────────────────────────

module('Pretui | structure-layout | AspectRatio', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('actual renders a real img with intrinsic sizing and real alt', async function (assert) {
    await render(
      <template>
        <AspectRatio
          @ratio='16 / 9'
          @src={{PIXEL}}
          @alt='Estate at dawn'
          @width={{1600}}
          @height={{900}}
        />
      </template>,
    );
    let box = root().querySelector('[data-test-pretui-aspect-ratio]');
    let img = box?.querySelector('img');
    assert.strictEqual(box?.getAttribute('data-fit'), 'actual');
    assert.ok(img, 'a real img, not a painted div');
    assert.strictEqual(img?.getAttribute('alt'), 'Estate at dawn');
    assert.strictEqual(img?.getAttribute('width'), '1600');
    assert.strictEqual(img?.getAttribute('height'), '900');
    assert.strictEqual(img?.getAttribute('loading'), 'lazy');
    assert.strictEqual(img?.getAttribute('decoding'), 'async');
    assert.notOk(
      box?.getAttribute('role'),
      'the frame is not an image role when a real img is inside it',
    );
  });

  test('the ratio reaches CSS as a custom property, in the spelling given', async function (assert) {
    await render(
      <template><AspectRatio @ratio='16 / 9' @src={{PIXEL}} @alt='x' /></template>,
    );
    let box = root().querySelector(
      '[data-test-pretui-aspect-ratio]',
    ) as HTMLElement;
    assert.strictEqual(
      box.style.getPropertyValue('--pretui-aspect-ratio').trim(),
      '16 / 9',
      'the authoring intent survives — not a pre-divided float',
    );
  });

  test('a numeric ratio is accepted too', async function (assert) {
    await render(
      <template><AspectRatio @ratio={{1.5}} @src={{PIXEL}} @alt='x' /></template>,
    );
    let box = root().querySelector(
      '[data-test-pretui-aspect-ratio]',
    ) as HTMLElement;
    assert.strictEqual(
      box.style.getPropertyValue('--pretui-aspect-ratio').trim(),
      '1.5',
    );
  });

  test('a named painted frame is an image role with that name', async function (assert) {
    await render(
      <template>
        <AspectRatio @ratio={{1}} @fit='cover' @src={{PIXEL}} @alt='A portrait' />
      </template>,
    );
    let box = root().querySelector(
      '[data-test-pretui-aspect-ratio]',
    ) as HTMLElement;
    assert.strictEqual(box.getAttribute('data-fit'), 'cover');
    assert.strictEqual(box.getAttribute('role'), 'img');
    assert.strictEqual(box.getAttribute('aria-label'), 'A portrait');
    assert.ok(
      box.style.backgroundImage.includes('data:image/gif'),
      'and the guarded url reached the style attribute',
    );
    assert.strictEqual(box.querySelectorAll('img').length, 0, 'no img element');
  });

  test('an empty alt drops the image role entirely', async function (assert) {
    await render(
      <template>
        <AspectRatio @ratio={{1}} @fit='cover' @src={{PIXEL}} @alt='' />
      </template>,
    );
    let box = root().querySelector('[data-test-pretui-aspect-ratio]');
    assert.notOk(
      box?.getAttribute('role'),
      'an unnamed image role announces as bare "image" and is worse than none',
    );
    assert.notOk(box?.getAttribute('aria-label'), 'and carries no empty name');
  });

  test('a whitespace-only alt counts as empty', async function (assert) {
    await render(
      <template>
        <AspectRatio @ratio={{1}} @fit='contain' @src={{PIXEL}} @alt='   ' />
      </template>,
    );
    assert.notOk(
      root().querySelector('[data-test-pretui-aspect-ratio]')?.getAttribute('role'),
    );
  });

  test('a hostile src never reaches the stylesheet', async function (assert) {
    const BAD = 'javascript:alert(1)';
    await render(
      <template>
        <AspectRatio @ratio={{1}} @fit='cover' @src={{BAD}} @alt='x' />
      </template>,
    );
    let box = root().querySelector(
      '[data-test-pretui-aspect-ratio]',
    ) as HTMLElement;
    assert.strictEqual(
      box.style.backgroundImage,
      '',
      'the guard dropped it whole rather than sanitising part of it',
    );
    assert.strictEqual(
      box.style.getPropertyValue('--pretui-aspect-ratio').trim(),
      '1',
      'while the rest of the declaration survives',
    );
  });

  test('the slot form frames arbitrary content', async function (assert) {
    await render(
      <template>
        <AspectRatio @ratio='4 / 3'><span class='t-slot'>x</span></AspectRatio>
      </template>,
    );
    let box = root().querySelector('[data-test-pretui-aspect-ratio]');
    assert.strictEqual(box?.getAttribute('data-fit'), 'slot');
    assert.ok(root().querySelector('.t-slot'), 'the child renders');
    assert.strictEqual(box?.querySelectorAll('img').length, 0);
  });

  test('AspectBox is the same component under the foundation name', async function (assert) {
    assert.strictEqual(
      AspectBox,
      AspectRatio,
      'one implementation, two entry points — never two frames',
    );
    await render(
      <template><AspectBox @ratio={{1}}><span>x</span></AspectBox></template>,
    );
    assert.ok(root().querySelector('[data-test-pretui-aspect-ratio]'));
  });
});
