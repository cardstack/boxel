// Pretui — render + semantics proof for blocks.gts (ReadinessPanel,
// HeroSplit, StepsWithMedia, CtaBand).
//
// Run with `boxel test`; deployment leaves `*.test.gts` off the realm.
//
// What is asserted here is structure, ARIA, DOM ORDER and reflected state.
// Nothing asserts a computed style: `boxel test` stamps the scoped-CSS
// attribute and delivers no stylesheet, so every colour, size and layout
// value reads as its initial value in this harness. The interesting claims
// these blocks make are structural anyway — "the content column comes first
// in source order", "a blocked panel renders its reasons above the gates",
// "an unrecognised state still renders a row" — and those are all real DOM.
import { module, test } from 'qunit';
import { render } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';

import { CtaBand } from './components/cta-band';
import { HeroSplit } from './components/hero-split';
import { ReadinessPanel } from './components/readiness-panel';
import { StepsWithMedia } from './components/steps-with-media';
import type { ReadinessGate } from './components/readiness-panel';
import type { StepItem } from './components/step-list';
import type { MediaAssetSpec } from './internal/media-viewer';
import { DEMOS_CTA_BAND } from './components/cta-band.usage';
import { DEMOS_HERO_SPLIT } from './components/hero-split.usage';
import { DEMOS_READINESS_PANEL } from './components/readiness-panel.usage';
import { DEMOS_STEPS_WITH_MEDIA } from './components/steps-with-media.usage';

// Pages are looked up by component name through the merged loadable registry,
// so this test does not care which module a page lives in.
const PAGES: Record<string, unknown> = { ...DEMOS_CTA_BAND, ...DEMOS_HERO_SPLIT, ...DEMOS_READINESS_PANEL, ...DEMOS_STEPS_WITH_MEDIA };

function root(): HTMLElement {
  return document.querySelector('#ember-testing') as HTMLElement;
}

/** True when `b` follows `a` in document order.
 *
 * The bit is named locally rather than read from `Node.DOCUMENT_POSITION_
 * FOLLOWING`: in the `boxel test` harness that constant reads as
 * `undefined`, and `4 & undefined` is `0`, so the assertion fails for a
 * reason that has nothing to do with the DOM. Measured, not guessed. */
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

const PASSING: ReadinessGate[] = [
  { id: 'a', name: 'Test suite', state: 'pass', value: '12 / 12' },
  { id: 'b', name: 'Lint', state: 'pass' },
  { id: 'c', name: 'Changelog', state: 'skipped' },
];

const FAILING: ReadinessGate[] = [
  { id: 'a', name: 'Test suite', state: 'fail', caption: 'Two suites red' },
  { id: 'b', name: 'Lint', state: 'running' },
  // Same NAME as the first gate — the source keyed on name and lost this row.
  { id: 'a-legacy', name: 'Test suite', state: 'skipped' },
];

const ODD: ReadinessGate[] = [
  { id: 'a', name: 'Test suite', state: 'pass' },
  // A state nothing whitelists. It must still render, as `unknown`.
  { id: 'b', name: 'Weather', state: 'moonphase' as ReadinessGate['state'] },
];

const REASONS = ['Suites are red.', 'Budget cannot be measured.'];
const NO_REASONS: string[] = [];
const NO_GATES: ReadinessGate[] = [];

const ASSET: MediaAssetSpec = {
  src: 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2016%209%22%3E%3C%2Fsvg%3E',
  name: 'Stage plate',
  kind: 'image',
  alt: 'A stand-in plate',
  width: 1600,
  height: 900,
};

const STEPS: StepItem[] = [
  { label: 'Open a lot' },
  { label: 'Set a ceiling' },
  { label: 'Settle' },
];

const CHIPS = [{ label: 'One' }, { label: 'Two' }];

/* eslint-disable @typescript-eslint/no-explicit-any -- DEMOS registries are
   Record<string, unknown> by design; a test that mounts one must assert the
   component shape. */
const Pages = {
  ReadinessPanel: PAGES['ReadinessPanel'] as any,
  HeroSplit: PAGES['HeroSplit'] as any,
  StepsWithMedia: PAGES['StepsWithMedia'] as any,
  CtaBand: PAGES['CtaBand'] as any,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

module('Pretui | blocks | ReadinessPanel', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('derives a blocked verdict and puts the reasons above the gates', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release 4.11'
          @gates={{FAILING}}
          @reasons={{REASONS}}
        />
      </template>,
    );
    let panel = root().querySelector('[data-test-pretui-readiness-panel]');
    assert.ok(panel, 'the panel renders');
    assert.strictEqual(
      panel?.getAttribute('data-verdict'),
      'blocked',
      'a failing gate derives blocked',
    );

    let reasons = root().querySelector('[data-test-pretui-readiness-reasons]');
    let gates = root().querySelector('[data-test-pretui-readiness-gates]');
    assert.ok(reasons, 'the reasons block renders');
    assert.ok(gates, 'the gate list renders');
    assert.ok(
      precedes(reasons, gates),
      'why is read before what — reasons precede the gate inventory',
    );

    let items = reasons?.querySelectorAll('li') ?? [];
    assert.strictEqual(items.length, 2, 'reasons are list items, not spans');
    let list = reasons?.querySelector('ul');
    assert.ok(
      list?.getAttribute('aria-label')?.includes('2'),
      'and the count rides the list accessible name',
    );
  });

  test('two gates with the same name both survive', async function (assert) {
    await render(
      <template>
        <ReadinessPanel @title='Release' @gates={{FAILING}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-readiness-gate]').length,
      3,
      'keyed on id, not on name',
    );
  });

  test('an unrecognised state renders as unknown rather than vanishing', async function (assert) {
    await render(
      <template>
        <ReadinessPanel @title='Release' @gates={{ODD}} />
      </template>,
    );
    let rows = root().querySelectorAll('[data-test-pretui-readiness-gate]');
    assert.strictEqual(rows.length, 2, 'both rows render');
    assert.strictEqual(
      rows[1]?.getAttribute('data-state'),
      'unknown',
      'the unrecognised state resolves to unknown',
    );
  });

  test('derives ready and drops the reasons block entirely', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release'
          @gates={{PASSING}}
          @reasons={{NO_REASONS}}
        />
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-readiness-panel]')
        ?.getAttribute('data-verdict'),
      'ready',
      'all pass or skipped is ready',
    );
    assert.notOk(
      root().querySelector('[data-test-pretui-readiness-reasons]'),
      'a ready panel has no middle — the difference is structural',
    );
  });

  test('an explicit verdict wins over the derivation', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release'
          @gates={{PASSING}}
          @verdict='blocked'
          @verdictText='Held by the release manager'
        />
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-readiness-panel]')
        ?.getAttribute('data-verdict'),
      'blocked',
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-readiness-verdict-text]')
        ?.textContent?.trim(),
      'Held by the release manager',
      'and the wording is an arg, not a hardcoded string',
    );
  });

  test('loading reserves rows and is not the empty state', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release'
          @gates={{NO_GATES}}
          @loading={{true}}
          @loadingRows={{4}}
        />
      </template>,
    );
    let loading = root().querySelector('[data-test-pretui-readiness-loading]');
    assert.ok(loading, 'the loading list renders');
    assert.strictEqual(
      loading?.getAttribute('aria-busy'),
      'true',
      'and says so',
    );
    assert.strictEqual(
      loading?.querySelectorAll('li').length,
      4,
      'reserving the requested number of rows',
    );
    assert.notOk(
      root().querySelector('[data-test-pretui-readiness-empty]'),
      'loading is never mistaken for empty',
    );
  });

  test('no gates renders the empty state', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Compliance'
          @gates={{NO_GATES}}
          @emptyTitle='No checks configured'
        />
      </template>,
    );
    assert.ok(root().querySelector('[data-test-pretui-readiness-empty]'));
    assert.notOk(root().querySelector('[data-test-pretui-readiness-gates]'));
  });

  test('not applicable renders nothing at all', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release'
          @gates={{PASSING}}
          @applicable={{false}}
        />
      </template>,
    );
    assert.notOk(
      root().querySelector('[data-test-pretui-readiness-panel]'),
      'an empty shell would read as "no problems", which is not what this means',
    );
  });

  test('the verdict is carried by a polite live region', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release 4.11'
          @gates={{FAILING}}
          @reasons={{REASONS}}
        />
      </template>,
    );
    let live = root().querySelector('[data-test-pretui-readiness-live]');
    assert.ok(live, 'the live region exists');
    assert.strictEqual(live?.getAttribute('role'), 'status');
    let text = live?.textContent ?? '';
    assert.ok(text.includes('Release 4.11'), 'naming what was judged');
    assert.ok(text.includes('2 blocking'), 'and how much is in the way');
  });

  test('announce can be turned off', async function (assert) {
    await render(
      <template>
        <ReadinessPanel
          @title='Release'
          @gates={{PASSING}}
          @announce={{false}}
        />
      </template>,
    );
    assert.notOk(root().querySelector('[data-test-pretui-readiness-live]'));
  });

  test('the title is the panel accessible name', async function (assert) {
    await render(
      <template>
        <ReadinessPanel @title='Release 4.11' @gates={{PASSING}} />
      </template>,
    );
    let panel = root().querySelector('[data-test-pretui-readiness-panel]');
    let id = panel?.getAttribute('aria-labelledby') ?? '';
    assert.ok(id.length > 0, 'aria-labelledby is set');
    assert.strictEqual(
      root().querySelector('#' + id)?.textContent?.trim(),
      'Release 4.11',
      'and it resolves to the heading',
    );
  });
});

module('Pretui | blocks | HeroSplit', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('content precedes the media in source order, whichever side it shows on', async function (assert) {
    await render(
      <template>
        <HeroSplit
          @headline='Buy the lot'
          @asset={{ASSET}}
          @mediaSide='start'
        />
      </template>,
    );
    let hero = root().querySelector('[data-test-pretui-hero-split]');
    assert.strictEqual(
      hero?.getAttribute('data-media-side'),
      'start',
      'the visual side is reflected',
    );
    let media = root().querySelector('[data-test-pretui-hero-media]');
    let heading = root().querySelector('h2');
    assert.ok(media && heading, 'both columns render');
    assert.ok(
      precedes(heading, media),
      'the headline is reached first by a screen reader and by Tab',
    );
  });

  test('the headline names the section', async function (assert) {
    await render(
      <template>
        <HeroSplit @headline='Buy the lot' @asset={{ASSET}} />
      </template>,
    );
    let hero = root().querySelector('[data-test-pretui-hero-split]');
    let id = hero?.getAttribute('aria-labelledby') ?? '';
    assert.strictEqual(
      root().querySelector('#' + id)?.textContent?.trim(),
      'Buy the lot',
    );
  });

  test('chips are data and render as a list', async function (assert) {
    await render(
      <template>
        <HeroSplit @headline='Buy the lot' @chips={{CHIPS}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-chip]').length,
      2,
    );
  });

  test('a stated ratio is reflected on the stage', async function (assert) {
    await render(
      <template>
        <HeroSplit @headline='Buy the lot' @asset={{ASSET}} @ratio='16 / 9' />
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-hero-media]')
        ?.getAttribute('data-ratio'),
      'fixed',
    );
  });

  test('no asset and no media block means no stage', async function (assert) {
    await render(
      <template><HeroSplit @headline='Buy the lot' /></template>,
    );
    assert.notOk(root().querySelector('[data-test-pretui-hero-media]'));
  });

  test('the heading level is the caller decision', async function (assert) {
    await render(
      <template>
        <HeroSplit @headline='Buy the lot' @headingLevel={{1}} />
      </template>,
    );
    assert.strictEqual(
      root().querySelector('h2')?.getAttribute('aria-level'),
      '1',
    );
  });
});

module('Pretui | blocks | StepsWithMedia', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('composes StepList rather than reimplementing step semantics', async function (assert) {
    await render(
      <template>
        <StepsWithMedia
          @title='How it works'
          @steps={{STEPS}}
          @current={{1}}
          @asset={{ASSET}}
        />
      </template>,
    );
    assert.ok(
      root().querySelector('[data-test-pretui-step-list]'),
      'the kit StepList is what draws the steps',
    );
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-step-list] li').length,
      3,
    );
    assert.ok(
      root().querySelector('[aria-current="step"]'),
      'and it keeps aria-current on the current step',
    );
  });

  test('the media column is static and reflects its side', async function (assert) {
    await render(
      <template>
        <StepsWithMedia @steps={{STEPS}} @asset={{ASSET}} @mediaSide='end' />
      </template>,
    );
    assert.strictEqual(
      root()
        .querySelector('[data-test-pretui-steps-with-media]')
        ?.getAttribute('data-media-side'),
      'end',
    );
    assert.ok(root().querySelector('[data-test-pretui-swm-media]'));
  });

  test('content precedes the media in source order', async function (assert) {
    await render(
      <template>
        <StepsWithMedia
          @title='How it works'
          @steps={{STEPS}}
          @asset={{ASSET}}
          @mediaSide='start'
        />
      </template>,
    );
    let heading = root().querySelector('h2');
    let media = root().querySelector('[data-test-pretui-swm-media]');
    assert.ok(
      precedes(heading, media),
      'the title is reached before the picture',
    );
  });
});

module('Pretui | blocks | CtaBand', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(10000);
  });

  test('reflects the resolved appearance axes', async function (assert) {
    await render(
      <template>
        <CtaBand
          @headline='List your first lot'
          @tone='attention'
          @appearance='outlined'
          @align='start'
        />
      </template>,
    );
    let band = root().querySelector('[data-test-pretui-cta-band]');
    assert.strictEqual(band?.getAttribute('data-tone'), 'attention');
    assert.strictEqual(band?.getAttribute('data-appearance'), 'outlined');
    assert.strictEqual(band?.getAttribute('data-align'), 'start');
  });

  test('defaults to primary + accent and centres', async function (assert) {
    await render(
      <template><CtaBand @headline='List your first lot' /></template>,
    );
    let band = root().querySelector('[data-test-pretui-cta-band]');
    assert.strictEqual(band?.getAttribute('data-tone'), 'primary');
    assert.strictEqual(band?.getAttribute('data-appearance'), 'accent');
    assert.strictEqual(band?.getAttribute('data-align'), 'center');
  });

  test('the headline names the band and the actions slot renders', async function (assert) {
    await render(
      <template>
        <CtaBand @headline='List your first lot'>
          <:actions>
            <button type='button' data-test-cta-probe>List a lot</button>
          </:actions>
        </CtaBand>
      </template>,
    );
    let band = root().querySelector('[data-test-pretui-cta-band]');
    let id = band?.getAttribute('aria-labelledby') ?? '';
    assert.strictEqual(
      root().querySelector('#' + id)?.textContent?.trim(),
      'List your first lot',
    );
    assert.ok(
      root().querySelector('[data-test-pretui-cta-actions] [data-test-cta-probe]'),
      'the source shipped no CTA control at all; this is the point of it',
    );
  });
});

module('Pretui | blocks | usage pages', function (hooks) {
  setupCardTest(hooks);
  hooks.beforeEach(function (assert) {
    assert.timeout(15000);
  });

  test('every block has a usage page', function (assert) {
    for (let name of Object.keys(Pages)) {
      assert.ok(
        (Pages as Record<string, unknown>)[name],
        name + ' has a page — a catalog tile with no page is a tile that lies',
      );
    }
  });

  test('ReadinessPanel page mounts', async function (assert) {
    let Page = Pages.ReadinessPanel;
    await render(<template><Page /></template>);
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-readiness-panel]').length,
      3,
      'blocked, ready and empty side by side',
    );
  });

  test('HeroSplit page mounts', async function (assert) {
    let Page = Pages.HeroSplit;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-hero-split]'));
    assert.ok(root().querySelector('[data-test-pretui-hero-actions]'));
  });

  test('StepsWithMedia page mounts', async function (assert) {
    let Page = Pages.StepsWithMedia;
    await render(<template><Page /></template>);
    assert.ok(root().querySelector('[data-test-pretui-steps-with-media]'));
    assert.ok(root().querySelector('[data-test-pretui-step-list]'));
  });

  test('CtaBand page mounts', async function (assert) {
    let Page = Pages.CtaBand;
    await render(<template><Page /></template>);
    assert.strictEqual(
      root().querySelectorAll('[data-test-pretui-cta-band]').length,
      2,
    );
  });
});
