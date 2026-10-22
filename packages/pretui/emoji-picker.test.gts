// Pretui — runtime proof for emoji-picker.gts and the ported emoji engine.
//
// A clean index proves the module graph evaluates. It proves nothing about
// what the template did, and for this component it proves even less than
// usual: the dataset arrives through a dynamic `import()` inside a modifier,
// so a failure to resolve it would be invisible to parse, lint AND indexing
// and would show up only as a picker permanently stuck on "Loading emoji…".
// That is the single most important thing this file asserts.
//
// Four separate things are checked:
//   1. the ENGINE as pure functions — tokenising, the AND-plus-prefix search
//      contract, skin-tone resolution — with no renderer involved;
//   2. that the DATASET actually loads in a browser through the dynamic
//      import, and that it is complete (1,923 emoji, the expected groups);
//   3. the COMPONENT in a real browser render: categories, search, the
//      keyboard grid with its roving tabindex, skin tones, and selection;
//   4. the RECENT list ordering, which must be positional and must not
//      involve a wall clock.
//
// Run with `boxel test` from this directory; deployment leaves `*.test.gts`
// off the realm.
import { module, test } from 'qunit';
import { render, settled, click, fillIn, triggerKeyEvent } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { tracked } from '@glimmer/tracking';

import {
  EMOJI_GROUPS,
  EmojiIndex,
  applySkinTone,
  extractTokens,
  normalizeTokens,
  toneOf,
  type Emoji,
} from './emoji-data/engine';
import { EmojiPicker } from './components/emoji-picker';
import type { EmojiSelection } from './components/emoji-picker';

/** Pin the version so the canvas support probe cannot make results depend on
 * whichever emoji font the CI machine happens to have. */
const PINNED_VERSION = 15.1;

function cells(): NodeListOf<HTMLElement> {
  return document.querySelectorAll<HTMLElement>('[data-test-pretui-emoji-cell]');
}

function labels(): string[] {
  return [...cells()].map((c) => c.getAttribute('aria-label') || '');
}

async function pressGrid(key: string, options: Record<string, unknown> = {}) {
  await triggerKeyEvent(
    '[data-test-pretui-emoji-grid]',
    'keydown',
    key,
    options,
  );
}

module('Pretui | emoji-picker', function (hooks) {
  setupCardTest(hooks);

  // ── 1. The engine, as pure functions ───────────────────────────────────

  test('extractTokens matches the transform that built the dataset', function (assert) {
    // If these drift from the generator in emoji-data/README.md, every query
    // silently stops matching. That is the whole reason this test exists.
    assert.deepEqual(extractTokens('grinning face'), ['grinning', 'face']);
    assert.deepEqual(extractTokens('waving_hand'), ['waving', 'hand']);
    assert.deepEqual(extractTokens('FLAG: Japan'), ['flag', 'japan']);
    // Emoticons survive tokenising rather than being shredded by the
    // punctuation strip.
    assert.deepEqual(extractTokens(':D'), [':d']);
    assert.deepEqual(extractTokens('</3'), ['</3']);
  });

  test('normalizeTokens drops anything under the minimum length', function (assert) {
    assert.deepEqual(normalizeTokens(['a', 'ok', 'CAT']), ['ok', 'cat']);
  });

  test('applySkinTone handles the plain and the ZWJ cases', function (assert) {
    // No tone is the identity.
    assert.strictEqual(applySkinTone('\u{1F590}\u{FE0F}', 0), '\u{1F590}\u{FE0F}');
    // The variation selector is dropped before the modifier is appended,
    // otherwise the sequence is invalid and renders as two glyphs.
    assert.strictEqual(
      applySkinTone('\u{1F590}\u{FE0F}', 1),
      '\u{1F590}\u{1F3FB}',
    );
    // In a ZWJ sequence the modifier goes before the joiner, not at the end.
    let zwj = applySkinTone('\u{1F468}‍\u{1F373}', 5);
    assert.true(zwj.startsWith('\u{1F468}\u{1F3FF}'), 'modifier precedes the ZWJ');
  });

  // ── 2. The dataset actually loads, through the dynamic import ──────────

  module('dataset', function (nested) {
    let index: EmojiIndex;

    nested.before(async function () {
      // This is the dynamic import. If the realm loader cannot resolve
      // './data' from the engine module, this line is where it fails — and
      // nothing else in the gate chain would have told us.
      index = await EmojiIndex.load(99);
    });

    test('loads the whole local dataset with no network request', function (assert) {
      // 1,923 in the source file, minus the 9 "component" entries (skin-tone
      // and hair modifiers), which are not pickable emoji.
      assert.strictEqual(index.all.length, 1923 - 9, '1,914 pickable emoji');
      assert.strictEqual(
        index.all.filter((e) => e.group === 2).length,
        0,
        'the component group is excluded',
      );
    });

    test('every declared category is populated', function (assert) {
      for (let group of EMOJI_GROUPS) {
        assert.true(
          index.byGroup(group.id).length > 0,
          group.key + ' has emoji',
        );
      }
    });

    test('every emoji carries a CLDR annotation for its accessible name', function (assert) {
      let missing = index.all.filter((e) => !e.annotation || !e.annotation.trim());
      assert.strictEqual(missing.length, 0, 'no emoji lacks an accessible name');
    });

    test('categories come back in dataset order', function (assert) {
      let orders = index.byGroup(0).map((e) => e.order);
      let sorted = [...orders].sort((a, b) => a - b);
      assert.deepEqual(orders, sorted, 'group 0 is ordered');
    });

    // ── The search contract ──────────────────────────────────────────────

    test('search finds an emoji by its annotation', function (assert) {
      let results = index.search('grinning face');
      assert.true(results.length > 0, 'has results');
      assert.true(
        results.some((e) => e.unicode === '\u{1F600}'),
        'grinning face is among them',
      );
    });

    test('search finds an emoji by a tag that is not in its name', function (assert) {
      // "hello" is a tag on the waving hand, not part of "waving hand".
      let results = index.search('hello');
      assert.true(
        results.some((e) => e.unicode === '\u{1F44B}'),
        'tags are searchable, not just annotations',
      );
    });

    test('the LAST token is a prefix match so results narrow as you type', function (assert) {
      let full = index.search('elephant');
      let partial = index.search('eleph');
      assert.true(full.length > 0, 'the full word matches');
      assert.true(
        partial.some((e) => e.unicode === '\u{1F418}'),
        'a prefix of the last token still matches',
      );
    });

    test('EARLIER tokens must match exactly, so a second word narrows', function (assert) {
      let one = index.search('face');
      let two = index.search('face tear');
      assert.true(two.length > 0, 'the two-token query has results');
      assert.true(
        two.length < one.length,
        'ANDing tokens narrows rather than widens: ' +
          String(two.length) + ' < ' + String(one.length),
      );
      // Every result must satisfy BOTH tokens, which is the AND contract.
      assert.true(
        two.every((e) => one.some((o) => o.unicode === e.unicode)),
        'every two-token result is also a one-token result',
      );
    });

    test('results are returned in dataset order, not match order', function (assert) {
      let orders = index.search('face').map((e) => e.order);
      let sorted = [...orders].sort((a, b) => a - b);
      assert.deepEqual(orders, sorted, 'search results are ordered');
    });

    test('a query with no usable token returns nothing', function (assert) {
      // The guard that stops a single letter dumping the entire dataset.
      assert.deepEqual(index.search('a'), []);
      assert.deepEqual(index.search('   '), []);
    });

    test('search never returns a duplicate', function (assert) {
      let results = index.search('face');
      let unique = new Set(results.map((e) => e.unicode));
      assert.strictEqual(unique.size, results.length, 'no duplicates');
    });

    // ── Skin tones and version gating ────────────────────────────────────

    test('emoji with skin tones expose them, and toneOf resolves them', function (assert) {
      let wave = index.byUnicode('\u{1F44B}') as Emoji;
      assert.ok(wave, 'waving hand is present');
      assert.ok(wave.skins, 'it has skin variants');
      assert.strictEqual(toneOf(wave, 0), '\u{1F44B}', 'tone 0 is untoned');
      assert.strictEqual(toneOf(wave, 3), '\u{1F44B}\u{1F3FD}', 'tone 3 resolves');
    });

    test('an emoji with no variant for a tone falls back to untoned', function (assert) {
      let cat = index.byUnicode('\u{1F431}') as Emoji;
      assert.ok(cat, 'cat face is present');
      assert.strictEqual(toneOf(cat, 4), '\u{1F431}', 'no variant, no change');
    });

    test('a low support level hides emoji the font could not draw', async function (assert) {
      let old = await EmojiIndex.load(1);
      assert.true(
        old.all.length < index.all.length,
        'version gating removes newer emoji: ' +
          String(old.all.length) + ' < ' + String(index.all.length),
      );
      assert.true(
        old.all.every((e) => e.version <= 1),
        'nothing newer than the support level survives',
      );
    });
  });

  // ── 3. The component, rendered in a real browser ───────────────────────

  test('it renders, loads its data and shows a category', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    assert
      .dom('[data-test-pretui-emoji-picker]')
      .exists('the picker rendered');
    // The status attribute flips to ready only after the dynamic import
    // resolved and the index was built. This is the assertion that a broken
    // lazy import would fail, and nothing else would.
    assert
      .dom('[data-test-pretui-emoji-picker]')
      .hasAttribute('data-status', 'ready', 'the dataset loaded in the browser');
    assert.dom('[data-test-pretui-emoji-loading]').doesNotExist();
    assert.dom('[data-test-pretui-emoji-error]').doesNotExist();
    assert.true(cells().length > 100, 'the first category is populated');
  });

  test('the grid carries the APG grid roles, not menu roles', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    assert.dom('[data-test-pretui-emoji-grid]').hasAttribute('role', 'grid');
    assert.dom('[data-test-pretui-emoji-grid] [role="row"]').exists();
    let cell = cells()[0]!;
    assert.strictEqual(cell.getAttribute('role'), 'gridcell');
    // Upstream renders these as role=menuitem inside role=menu, which gives a
    // screen reader no row or column position.
    assert.dom('[role="menu"]').doesNotExist('no menu role anywhere');
  });

  test('every cell has the CLDR annotation as its accessible name', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    let unnamed = [...cells()].filter((c) => !c.getAttribute('aria-label'));
    assert.strictEqual(unnamed.length, 0, 'no cell is announced as a codepoint');
    assert.strictEqual(
      cells()[0]!.getAttribute('aria-label'),
      'grinning face',
      'the first cell is named, not numbered',
    );
  });

  test('the grid is ONE tab stop with a roving tabindex', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    let all = [...cells()];
    let tabbable = all.filter((c) => c.tabIndex === 0);
    // This is the headline fix over upstream, which leaves all 388 buttons
    // natively tabbable because it never sets tabindex at all.
    assert.strictEqual(tabbable.length, 1, 'exactly one cell is tabbable');
    assert.strictEqual(all[0]!.tabIndex, 0, 'and it is the first one');
    assert.strictEqual(all[1]!.tabIndex, -1, 'the rest are removed from the order');
  });

  test('arrow keys move in two dimensions and Home/End reach the row ends', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} @columns={{9}} />
    </template>);
    await settled();

    let tabbableIndex = () => [...cells()].findIndex((c) => c.tabIndex === 0);

    await pressGrid('ArrowRight');
    assert.strictEqual(tabbableIndex(), 1, 'ArrowRight moves one column');

    await pressGrid('ArrowDown');
    assert.strictEqual(tabbableIndex(), 10, 'ArrowDown moves one full row');

    await pressGrid('ArrowLeft');
    assert.strictEqual(tabbableIndex(), 9, 'ArrowLeft moves back one column');

    await pressGrid('End');
    assert.strictEqual(tabbableIndex(), 17, 'End reaches the end of the row');

    await pressGrid('Home');
    assert.strictEqual(tabbableIndex(), 9, 'Home reaches the start of the row');

    await pressGrid('PageDown');
    assert.strictEqual(tabbableIndex(), 9 + 45, 'PageDown moves five rows');

    await pressGrid('PageUp');
    assert.strictEqual(tabbableIndex(), 9, 'PageUp moves five rows back');

    await pressGrid('End', { ctrlKey: true });
    assert.strictEqual(
      tabbableIndex(),
      cells().length - 1,
      'Ctrl+End reaches the last emoji in the category',
    );

    await pressGrid('Home', { ctrlKey: true });
    assert.strictEqual(tabbableIndex(), 0, 'Ctrl+Home reaches the first');
  });

  test('arrow keys never walk off the ends of the grid', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} @columns={{9}} />
    </template>);
    await settled();

    let tabbableIndex = () => [...cells()].findIndex((c) => c.tabIndex === 0);

    await pressGrid('ArrowLeft');
    assert.strictEqual(tabbableIndex(), 0, 'ArrowLeft at the start stays put');

    await pressGrid('End', { ctrlKey: true });
    let last = cells().length - 1;
    await pressGrid('ArrowRight');
    assert.strictEqual(tabbableIndex(), last, 'ArrowRight at the end stays put');
    await pressGrid('ArrowDown');
    assert.strictEqual(
      tabbableIndex(),
      last,
      'ArrowDown on the last partial row stays put',
    );
  });

  test('searching filters the grid and announces politely, not per keystroke', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    let before = cells().length;
    await fillIn('[data-test-pretui-emoji-search]', 'elephant');
    await settled();

    assert.true(cells().length < before, 'the grid filtered');
    assert.true(
      labels().some((l) => l.includes('elephant')),
      'the elephant is in the results',
    );
    // The live region exists and is polite, and is still empty immediately
    // after typing — the announcement is delayed so a screen reader is not
    // read a result count on every keystroke.
    assert.dom('[data-test-pretui-emoji-live]').hasAttribute('role', 'status');
    assert
      .dom('[data-test-pretui-emoji-live]')
      .hasText('', 'nothing is announced on the keystroke itself');
  });

  test('a search with no matches shows an empty state in text', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    await fillIn('[data-test-pretui-emoji-search]', 'zzzzqqqq');
    await settled();

    assert.dom('[data-test-pretui-emoji-empty]').exists('empty state shown');
    // The empty state names the term that found nothing and offers the way
    // out, rather than showing a magnifier emoji over a bare "not found" —
    // the emoji had no figure/ground distinction from the grid of emoji it
    // was standing in for.
    assert
      .dom('[data-test-pretui-emoji-empty]')
      .containsText('No emoji match', 'the empty state says what happened');
    assert
      .dom('[data-test-pretui-emoji-empty]')
      .containsText('zzzzqqqq', 'and echoes the term that found nothing');
    assert
      .dom('[data-test-pretui-emoji-empty-clear]')
      .exists('the empty state offers a next action');

    await click('[data-test-pretui-emoji-empty-clear]');
    await settled();
    assert
      .dom('[data-test-pretui-emoji-empty]')
      .doesNotExist('clearing from the empty state restores the grid');
  });

  test('clearing the search restores the category', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    let before = cells().length;
    await fillIn('[data-test-pretui-emoji-search]', 'elephant');
    await settled();
    await click('[data-test-pretui-emoji-clear]');
    await settled();

    assert.strictEqual(cells().length, before, 'the full category is back');
  });

  test('category tabs switch the grid and carry the tab pattern', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    let tabs = document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-emoji-tab]',
    );
    assert.strictEqual(
      tabs.length,
      EMOJI_GROUPS.length,
      'one tab per category, and no recents tab before anything is picked',
    );
    assert.dom('[data-test-pretui-emoji-tabs]').hasAttribute('role', 'tablist');
    assert.strictEqual(tabs[0]!.getAttribute('aria-selected'), 'true');
    // Exactly one tab is in the tab order — the roving tabindex the tab
    // pattern requires.
    assert.strictEqual(
      [...tabs].filter((t) => t.getAttribute('tabindex') === '0').length,
      1,
      'one tab stop across the tablist',
    );

    let firstLabel = labels()[0];
    await click(tabs[3]!);
    await settled();
    assert.strictEqual(tabs[3]!.getAttribute('aria-selected'), 'true');
    assert.notStrictEqual(labels()[0], firstLabel, 'the grid changed category');
  });

  test('skin tone selection changes the rendered glyph and is announced', async function (assert) {
    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
    </template>);
    await settled();

    // Go to the people category, which is where tones apply.
    let tabs = document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-emoji-tab]',
    );
    await click(tabs[1]!);
    await settled();

    let before = cells()[0]!.textContent || '';

    let toneButton = document.querySelector<HTMLElement>(
      '[data-test-pretui-emoji-tone-button]',
    )!;
    assert.strictEqual(
      toneButton.getAttribute('aria-expanded'),
      'false',
      'the tone list starts closed',
    );
    assert.true(
      (toneButton.getAttribute('aria-label') || '').includes('Default'),
      'the current tone is named in the button label, not shown by colour alone',
    );

    await click(toneButton);
    await settled();
    assert.dom('[data-test-pretui-emoji-tone-list]').exists();
    assert.dom('[data-test-pretui-emoji-tone-list]').hasAttribute('role', 'listbox');
    assert.strictEqual(toneButton.getAttribute('aria-expanded'), 'true');

    let options = document.querySelectorAll<HTMLElement>(
      '[data-test-pretui-emoji-tone-option]',
    );
    assert.strictEqual(options.length, 6, 'six tones');
    // Every option is named in text as well as shown as a swatch.
    assert.true(
      [...options].every((o) => (o.textContent || '').trim().length > 1),
      'each tone carries a text name beside the swatch',
    );

    await click(options[5]!);
    await settled();

    assert.dom('[data-test-pretui-emoji-tone-list]').doesNotExist('list closed');
    assert.notStrictEqual(
      cells()[0]!.textContent,
      before,
      'the grid re-rendered with the dark tone applied',
    );
    assert.true(
      (
        document.querySelector('[data-test-pretui-emoji-tone-button]')
          ?.getAttribute('aria-label') || ''
      ).includes('Dark'),
      'the new tone is named in the button label',
    );
  });

  // ── 4. Selection and the wall-clock-free recent list ───────────────────

  test('choosing an emoji reports it with its annotation', async function (assert) {
    class State {
      @tracked picked: EmojiSelection | undefined;
      onSelect = (selection: EmojiSelection) => (this.picked = selection);
    }
    let state = new State();

    await render(<template>
      <EmojiPicker @emojiVersion={{PINNED_VERSION}} @onSelect={{state.onSelect}} />
    </template>);
    await settled();

    await click(cells()[0]!);
    await settled();

    assert.strictEqual(state.picked?.unicode, '\u{1F600}');
    assert.strictEqual(state.picked?.base, '\u{1F600}');
    assert.strictEqual(state.picked?.annotation, 'grinning face');
    assert.strictEqual(state.picked?.skinTone, 0);
  });

  test('recent ordering is positional, with no timestamp anywhere', async function (assert) {
    class State {
      @tracked recent: readonly string[] = [];
      onRecent = (recent: readonly string[]) => (this.recent = recent);
    }
    let state = new State();

    await render(<template>
      <EmojiPicker
        @emojiVersion={{PINNED_VERSION}}
        @recent={{state.recent}}
        @onRecent={{state.onRecent}}
      />
    </template>);
    await settled();

    let first = cells()[0]!;
    let second = cells()[1]!;
    let firstGlyph = (first.textContent || '').trim();
    let secondGlyph = (second.textContent || '').trim();

    await click(first);
    await settled();
    assert.deepEqual(
      [...state.recent],
      [firstGlyph],
      'the list is plain unicode strings — no objects, no timestamps',
    );

    await click(cells()[1]!);
    await settled();
    assert.deepEqual(
      [...state.recent],
      [secondGlyph, firstGlyph],
      'most recent first',
    );

    // Re-picking an emoji already in the list MOVES it rather than adding a
    // duplicate, which is the whole behaviour a timestamp would normally buy.
    await click(cells()[0]!);
    await settled();
    assert.deepEqual(
      [...state.recent],
      [firstGlyph, secondGlyph],
      're-picking promotes rather than duplicating',
    );
  });

  test('the recent limit is honoured and the recents tab appears', async function (assert) {
    class State {
      @tracked recent: readonly string[] = [];
      onRecent = (recent: readonly string[]) => (this.recent = recent);
    }
    let state = new State();

    await render(<template>
      <EmojiPicker
        @emojiVersion={{PINNED_VERSION}}
        @recentLimit={{2}}
        @recent={{state.recent}}
        @onRecent={{state.onRecent}}
      />
    </template>);
    await settled();

    for (let i = 0; i < 4; i++) {
      await click(cells()[i]!);
      await settled();
    }

    assert.strictEqual(state.recent.length, 2, 'trimmed to the limit');
    assert.strictEqual(
      document.querySelectorAll('[data-test-pretui-emoji-tab]').length,
      EMOJI_GROUPS.length + 1,
      'a recents tab appeared once the list was non-empty',
    );

    // The recents tab renders exactly the persisted list, in order.
    await click(
      document.querySelectorAll<HTMLElement>('[data-test-pretui-emoji-tab]')[0]!,
    );
    await settled();
    assert.strictEqual(cells().length, 2, 'the recents category holds two');
  });

  test('the picker makes no network request for its data', async function (assert) {
    // Upstream fetches its dataset from jsdelivr on every first load. If a
    // regression reintroduced that, this catches it: the whole render happens
    // with fetch replaced by a spy that fails the test.
    let originalFetch = globalThis.fetch;
    let calls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.reject(new Error('network disabled for this test'));
    }) as typeof fetch;

    try {
      await render(<template>
        <EmojiPicker @emojiVersion={{PINNED_VERSION}} />
      </template>);
      await settled();

      assert
        .dom('[data-test-pretui-emoji-picker]')
        .hasAttribute('data-status', 'ready', 'it loaded with fetch broken');
      assert.true(cells().length > 100, 'and it has emoji');
      assert.deepEqual(calls, [], 'no fetch was attempted');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
