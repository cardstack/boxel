// Pretui — ThemeFrame proof: the upper-left dark/light switch must actually
// re-resolve theme tokens for the page subtree, through the same machinery
// the host uses (data-theme → --boxel-color-scheme signal → CardContainer's
// scoped style container query).
import { module, test } from 'qunit';
import { render, click } from '@ember/test-helpers';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { ThemeFrame } from './components/theme-frame';
import { realmURL } from '@cardstack/base/card-api';

const THEME = {
  id: 'https://test.example/theme/probe',
  cardTitle: 'Probe Theme',
  cssVariables: `:root {
  --background: rgb(1, 2, 3);
  --pretui-probe: rgb(10, 20, 30);
}
.dark {
  --background: rgb(4, 5, 6);
  --pretui-probe: rgb(40, 50, 60);
}`,
};

function probeColor(): string {
  let probe = document.querySelector('[data-test-probe]') as HTMLElement;
  return getComputedStyle(probe).backgroundColor;
}

// The mode control is the dark mode switch: a checkbox with role='switch'.
async function setDarkMode(on: boolean) {
  let input = document.querySelector(
    '[data-test-pretui-theme-mode] input',
  ) as HTMLInputElement | null;
  if (!input) {
    throw new Error('no dark mode switch rendered');
  }
  if (input.checked !== on) {
    await click(input);
  }
}

module('Pretui | ThemeFrame', function (hooks) {
  setupCardTest(hooks);

  test('dark/light switch re-resolves theme tokens in the subtree', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{THEME}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--pretui-probe)'>
          probe
        </div>
      </ThemeFrame>
    </template>);

    assert.strictEqual(
      probeColor(),
      'rgb(10, 20, 30)',
      'the frame starts light',
    );
    assert
      .dom('[data-test-pretui-theme-frame]')
      .hasAttribute('data-theme', 'light', 'the frame stamps light, not an auto scheme');

    await setDarkMode(true);
    assert.strictEqual(
      probeColor(),
      'rgb(40, 50, 60)',
      'dark mode re-resolves the theme dark block — no component changed',
    );
    assert
      .dom('[data-test-pretui-theme-frame]')
      .hasAttribute('data-theme', 'dark', 'dark mode stamps dark');

    await setDarkMode(false);
    assert.strictEqual(
      probeColor(),
      'rgb(10, 20, 30)',
      'light mode forces the light set back on',
    );
    assert
      .dom('[data-test-pretui-theme-frame]')
      .hasAttribute('data-theme', 'light', 'light mode stamps light');
  });

  test('frame without a theme still flips boxel-ui ambient tokens', async function (assert) {
    await render(<template>
      <ThemeFrame>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--background)'>
          probe
        </div>
      </ThemeFrame>
    </template>);

    let lightBg = probeColor();
    await setDarkMode(true);
    assert.notStrictEqual(
      probeColor(),
      lightBg,
      'data-theme flip reaches --background even with no theme card',
    );
  });
});

// ── Theme selector proof ────────────────────────────────────────────────
// Regression guard for a defect that hid for the selector's whole life: the
// frame queried themes on `base/theme`/`default`, a re-export alias the realm
// search API does not resolve. A filter naming a ref nothing adopts matches
// ZERO cards rather than erroring, so `showThemeSelect` was permanently false
// and this entire branch had never rendered once. Fixing the ref turned the
// branch on for every page in the gallery at the same instant — so it needs a
// render proof of its own, not just a query fix.

// Three themes so the picker has something to choose between.
function contractTheme(slug: string, cardTitle: string, primary: string) {
  return {
    id: `https://test.example/theme/${slug}`,
    cardTitle,
    cssVariables: `:root {
  --primary: ${primary};
}`,
  };
}
const FIRST = contractTheme('first', 'First Theme', 'rgb(200, 0, 0)');
const SECOND = contractTheme('second', 'Second Theme', 'rgb(0, 200, 0)');
const THIRD = contractTheme('third', 'Third Theme', 'rgb(0, 0, 200)');
const THEMES = [FIRST, SECOND, THIRD];
const STUB_CONTEXT = {
  getCards: () => ({ instances: THEMES }),
};

module('Pretui | ThemeFrame · theme selector', function (hooks) {
  setupCardTest(hooks);

  test('a populated theme query renders the selector instead of a static name', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{FIRST}} @context={{STUB_CONTEXT}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);

    assert.ok(
      document.querySelector('[data-test-pretui-theme-bar]'),
      'the theme bar rendered — the selector branch does not throw',
    );
    assert.dom('[data-test-pretui-theme-name]').doesNotExist(
      'with 3 themes found the static name is replaced by the picker',
    );
    assert.ok(
      document.querySelector('[data-test-pretui-theme-pick]'),
      'the theme picker is present',
    );
  });

  test('picking another theme re-tints the subtree', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{FIRST}} @context={{STUB_CONTEXT}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);
    assert.strictEqual(probeColor(), 'rgb(200, 0, 0)', 'the linked theme applies');

    await click('[data-test-pretui-theme-pick] [data-test-pretui-select-trigger]');
    // the listbox renders in the dropdown wormhole, outside the frame
    let options = document.querySelectorAll(
      "[role='listbox'] [data-test-pretui-select-option]",
    );
    await click(options[1] as HTMLElement);
    assert.strictEqual(
      probeColor(),
      'rgb(0, 200, 0)',
      'the picked theme replaces it',
    );
  });

  test('theme labels read cardTitle, not title', async function (assert) {
    // CardDef exposes no `title`; reading it yielded undefined and every
    // option rendered "Untitled theme".
    await render(<template>
      <ThemeFrame @theme={{THIRD}} @context={{STUB_CONTEXT}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);
    let bar = document.querySelector('[data-test-pretui-theme-bar]') as HTMLElement;
    assert.notOk(
      /Untitled theme/.test(bar.textContent ?? ''),
      'no option falls back to the placeholder label',
    );
    assert.ok(
      /Third Theme/.test(bar.textContent ?? ''),
      `the active theme names itself (${bar.textContent?.trim()})`,
    );
  });

  test("themes are searched in the linked theme's realm, whatever form its id takes", async function (assert) {
    let searchedIn: string[] = [];
    let context = {
      getCards: (_parent: unknown, _query: unknown, realms: () => string[] | undefined) => {
        searchedIn.push(...(realms() ?? []));
        return { instances: THEMES };
      },
    };
    let theme = {
      ...FIRST,
      id: '@cardstack/catalog/Theme/first',
      [realmURL]: new URL('https://example.test/some-catalog/'),
    };
    await render(<template>
      <ThemeFrame @theme={{theme}} @context={{context}}>
        <div>probe</div>
      </ThemeFrame>
    </template>);
    assert.deepEqual(searchedIn, ['https://example.test/some-catalog/']);
  });

  test('no context degrades to the linked theme only — no selector, no throw', async function (assert) {
    await render(<template>
      <ThemeFrame @theme={{SECOND}}>
        {{! template-lint-disable no-inline-styles }}
        <div data-test-probe style='background: var(--primary)'>probe</div>
      </ThemeFrame>
    </template>);
    assert.dom('[data-test-pretui-theme-name]').hasText(
      'Second Theme',
      'prerender/test contexts still name the linked theme',
    );
  });
});
