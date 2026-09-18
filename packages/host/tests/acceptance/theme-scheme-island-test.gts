import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import {
  BoxelButton,
  BoxelContainer,
  Pill,
} from '@cardstack/boxel-ui/components';

import {
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupUserSubscription,
  setupAuthEndpoints,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  testRealmURL,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';
import { SOFT_POP_VARS } from '../helpers/theme-fixtures';

// A themed card whose template stamps `data-theme` / `.dark` on elements
// inside its own container, and nests another themed card that does the same.
// Covers the theme-scoped-css island rules, their stop at a nested themed
// card, and the theme.css chrome-knob reset on islands. The fixture renders
// more than the tests read (swatches, sample buttons, expectation labels): it
// doubles as a visual playground when a test is paused.

// theme.css `--canvas` defaults, which the themes here leave undefined
const BOXEL_CANVAS_LIGHT = '#f8f7fa';
const BOXEL_CANVAS_DARK = '#1e1b26';

// The `:root` / `.dark` blocks of a pasted stylesheet as ThemeVarField
// attributes, so a fixture can carry the full theme without a paste step
function cssBlockToThemeVars(
  css: string,
  selector: string,
): Record<string, string> {
  let block = css.split(selector)[1]?.split('}')[0] ?? '';
  let vars: Record<string, string> = {};
  for (let [, name, value] of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) {
    vars[name!.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())] =
      value!.trim();
  }
  return vars;
}

// Soft Pop is plainly light at the root and plainly dark in `.dark`, so a
// wrong scheme on the scheme-island card is visible at a glance
const SOFT_POP_ROOT_VARS = cssBlockToThemeVars(SOFT_POP_VARS, ':root');
const SOFT_POP_DARK_VARS = cssBlockToThemeVars(SOFT_POP_VARS, '.dark');

function computedProperty(selector: string, property: string): string {
  let el = document.querySelector(selector);
  if (!el) {
    throw new Error(`expected to find element: ${selector}`);
  }
  return window.getComputedStyle(el).getPropertyValue(property).trim();
}

// theme.css declares the boxel-ui chrome knobs in both scheme blocks, so an
// island would carry them unless the boundary reset repeats there; a knob
// reset to `initial` reads back as an empty computed value
function assertChromeKnobsReset(assert: Assert, selector: string) {
  assert.strictEqual(
    computedProperty(selector, '--boxel-button-primary-active-background'),
    '',
    `chrome knobs stay reset inside ${selector.split(' ').pop()}`,
  );
}

// Nested theme of the scheme-island card: a plainly light root palette and a
// plainly dark palette, distinct from Soft Pop and from the boxel-ui defaults.
// `accent` is defined at the root only, so dark contexts show whether a
// root-only token survives or falls back to the Boxel dark default.
const MEADOW_THEME_VARS = {
  background: '#f4f9f1',
  foreground: '#14261a',
  primary: '#2f7d4f',
  primaryForeground: '#f4f9f1',
  secondary: '#d9ecd4',
  secondaryForeground: '#14261a',
  accent: '#e8c547',
  accentForeground: '#14261a',
  muted: '#e6f0e2',
  mutedForeground: '#4a5e50',
  destructive: '#b3413a',
  destructiveForeground: '#f4f9f1',
  card: '#ffffff',
  cardForeground: '#14261a',
  popover: '#ffffff',
  popoverForeground: '#14261a',
  sidebar: '#e6f0e2',
  sidebarForeground: '#14261a',
  ring: '#2f7d4f',
  input: '#b9d1b3',
  border: '#c9dcc4',
  radius: '0.5rem',
  spacing: '0.25rem',
};

const MEADOW_DARK_VARS = {
  background: '#101a13',
  foreground: '#e6f0e2',
  primary: '#7fcf9a',
  primaryForeground: '#101a13',
  secondary: '#233326',
  secondaryForeground: '#d9ecd4',
  muted: '#1a281e',
  mutedForeground: '#a3b8a8',
  destructive: '#e0736b',
  destructiveForeground: '#101a13',
  card: '#182419',
  cardForeground: '#e6f0e2',
  popover: '#182419',
  popoverForeground: '#e6f0e2',
  sidebar: '#101a13',
  sidebarForeground: '#d9ecd4',
  ring: '#7fcf9a',
  input: '#2f4434',
  border: '#2f4434',
  radius: '0.5rem',
  spacing: '0.25rem',
};

module('Acceptance | theme scheme islands', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(async function () {
    mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    let loader = getService('loader-service').loader;
    let cardApi: typeof import('@cardstack/base/card-api') =
      await loader.import('@cardstack/base/card-api');
    let { field, linksTo, CardDef, Component } = cardApi;

    // Shows the variables each palette defines, painted with themselves, so the
    // scheme in effect can be read off the rendered card.
    const VarSwatches = <template>
      <ul class='var-swatches' ...attributes>
        <li class='swatch-background'>--background / --foreground</li>
        <li class='swatch-card'>--card / --card-foreground</li>
        <li class='swatch-primary'>--primary / --primary-foreground</li>
      </ul>
      <style scoped>
        .var-swatches {
          list-style: none;
          margin: 0;
          padding: 0;
          display: grid;
          gap: var(--boxel-sp-4xs);
          font: var(--boxel-font-xs);
        }
        .var-swatches li {
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          border: 1px solid var(--border);
        }
        .swatch-background {
          background-color: var(--background);
          color: var(--foreground);
        }
        .swatch-card {
          background-color: var(--card);
          color: var(--card-foreground);
        }
        .swatch-primary {
          background-color: var(--primary);
          color: var(--primary-foreground);
        }
      </style>
    </template>;

    class SchemeIslandCard extends CardDef {
      static displayName = 'Scheme Island Card';
      @field nested = linksTo(CardDef);

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          {{! The card root follows the ambient scheme: a card cannot switch
              the scheme of its own container, only of islands inside it }}
          <BoxelContainer @display='grid' data-test-scheme-island-root>
            <header aria-label='Card'>
              <Pill @variant='primary'>Ambient</Pill>
              <h2>Scheme Island Card</h2>
              <p>Expected: Soft Pop theme, the page's scheme (light in tests)</p>
              <div
                role='group'
                aria-label='Sample buttons'
                class='sample-buttons'
              >
                <BoxelButton @kind='default' @size='small'>Default</BoxelButton>
                <BoxelButton @kind='primary' @size='small'>Primary</BoxelButton>
                <BoxelButton
                  @kind='secondary'
                  @size='small'
                >Secondary</BoxelButton>
                <BoxelButton @kind='muted' @size='small'>Muted</BoxelButton>
                <BoxelButton
                  @kind='destructive'
                  @size='small'
                >Destructive</BoxelButton>
                <BoxelButton @kind='text-only' @size='small'>Text only</BoxelButton>
              </div>
              <VarSwatches />
            </header>
            <BoxelContainer
              class='island'
              @tag='section'
              @display='grid'
              data-theme='dark'
              data-test-dark-island
            >
              <header aria-label='Section 1'>
                <Pill @variant='primary'>Dark Island</Pill>
                <p>Expected: Soft Pop theme, dark mode</p>
                <VarSwatches />
              </header>
              <@fields.nested @format='embedded' />

              <BoxelContainer
                class='island'
                @display='grid'
                data-theme='light'
                data-test-light-island-in-dark
              >
                <header aria-label='Nested section'>
                  <Pill @variant='primary'>Light Island</Pill>
                  <p>Expected: Soft Pop theme, light mode</p>
                </header>
                <@fields.nested @format='embedded' />
              </BoxelContainer>
            </BoxelContainer>
            <BoxelContainer
              class='island'
              @tag='section'
              @display='grid'
              data-theme='light'
              data-test-light-island
            >
              <header aria-label='Section 2'>
                <Pill @variant='primary'>Light Island</Pill>
                <p>Expected: Soft Pop theme, light mode</p>
                <VarSwatches />
              </header>
              <@fields.nested @format='embedded' />
              <BoxelContainer
                class='island dark'
                @display='grid'
                data-test-dark-island-in-light
              >
                <header aria-label='Nested dark section'>
                  <Pill @variant='primary'>Dark Island (class)</Pill>
                  <p>Expected: Soft Pop theme, dark mode via the `dark` class</p>
                </header>
                <@fields.nested @format='embedded' />
              </BoxelContainer>
            </BoxelContainer>
          </BoxelContainer>
          <style scoped>
            .island {
              background-color: var(--card);
              color: var(--card-foreground);
              border-radius: var(--radius);
            }
            header {
              display: grid;
              justify-items: start;
              gap: var(--boxel-sp-xs);
            }
            .sample-buttons {
              display: flex;
              flex-wrap: wrap;
              gap: var(--boxel-sp-xs);
            }
            h2,
            p {
              margin: 0;
            }
          </style>
        </template>
      };

      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <BoxelContainer
            class='nested-embedded'
            @display='grid'
            data-test-nested-embedded
          >
            <Pill @variant='primary'>Embedded</Pill>
            <p>Expected: Meadow theme, mode of the surrounding island</p>
            <VarSwatches />
            <div
              class='nested-stamped'
              data-theme='dark'
              data-test-nested-stamped-island
            >
              <p>Expected: Meadow theme, dark mode (stamped here)</p>
              <VarSwatches />
            </div>
          </BoxelContainer>
          <style scoped>
            .nested-embedded {
              --boxel-container-gap: var(--boxel-sp-xs);
              justify-items: start;
            }
            .nested-stamped {
              display: grid;
              gap: var(--boxel-sp-xs);
              padding: var(--boxel-sp-xs);
              background-color: var(--background);
              color: var(--foreground);
              border-radius: var(--radius);
            }
            p {
              margin: 0;
            }
          </style>
        </template>
      };
    }

    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'scheme-island-card.gts': { SchemeIslandCard },
          'meadow-theme.json': {
            data: {
              meta: {
                adoptsFrom: {
                  name: 'default',
                  module: '@cardstack/base/structured-theme',
                },
              },
              type: 'card',
              attributes: {
                cardInfo: { name: 'Meadow' },
                rootVariables: MEADOW_THEME_VARS,
                darkModeVariables: MEADOW_DARK_VARS,
              },
            },
          },
          'soft-pop-theme.json': {
            data: {
              meta: {
                adoptsFrom: {
                  name: 'default',
                  module: '@cardstack/base/structured-theme',
                },
              },
              type: 'card',
              attributes: {
                cardInfo: { name: 'Soft Pop' },
                rootVariables: SOFT_POP_ROOT_VARS,
                darkModeVariables: SOFT_POP_DARK_VARS,
              },
            },
          },
          'scheme-island.json': {
            data: {
              meta: {
                adoptsFrom: {
                  name: 'SchemeIslandCard',
                  module: `${testRealmURL}scheme-island-card`,
                },
              },
              type: 'card',
              attributes: {
                cardInfo: { name: 'Scheme Island' },
              },
              relationships: {
                'cardInfo.theme': {
                  links: { self: `${testRealmURL}soft-pop-theme` },
                },
                nested: {
                  links: { self: `${testRealmURL}scheme-island-nested` },
                },
              },
            },
          },
          'scheme-island-nested.json': {
            data: {
              meta: {
                adoptsFrom: {
                  name: 'SchemeIslandCard',
                  module: `${testRealmURL}scheme-island-card`,
                },
              },
              type: 'card',
              attributes: {
                cardInfo: { name: 'Nested Scheme Island' },
              },
              relationships: {
                'cardInfo.theme': {
                  links: { self: `${testRealmURL}meadow-theme` },
                },
              },
            },
          },
          'realm.json': realmConfigCardJSON({ name: 'Theme Playground' }),
        },
      });
    });
  });

  test('dark mode variables apply inside a dark island the card template stamps', async function (assert) {
    let cardId = `${testRealmURL}scheme-island`;
    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    let rootSelector = `[data-test-card="${cardId}"] [data-test-scheme-island-root]`;
    let islandSelector = `${rootSelector} [data-test-dark-island]`;
    assert.strictEqual(
      computedProperty(rootSelector, '--primary'),
      SOFT_POP_ROOT_VARS.primary,
      'the card root follows the ambient light scheme',
    );
    assert.strictEqual(
      computedProperty(islandSelector, '--primary'),
      SOFT_POP_DARK_VARS.primary,
      'the dark --primary applies inside the island',
    );
    assert.strictEqual(
      computedProperty(islandSelector, '--background'),
      SOFT_POP_DARK_VARS.background,
      'the dark --background applies inside the island',
    );
    assert.strictEqual(
      computedProperty(islandSelector, '--card'),
      SOFT_POP_DARK_VARS.card,
      'the dark --card applies inside the island',
    );
    assert.strictEqual(
      computedProperty(islandSelector, '--canvas'),
      BOXEL_CANVAS_DARK,
      'a token the theme omits resolves to the boxel dark default inside the island',
    );
    assertChromeKnobsReset(assert, islandSelector);
  });

  test('islands nest and switch back, by attribute or by the dark class', async function (assert) {
    let cardId = `${testRealmURL}scheme-island`;
    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    let rootSelector = `[data-test-card="${cardId}"] [data-test-scheme-island-root]`;
    let lightInDark = `${rootSelector} [data-test-dark-island] [data-test-light-island-in-dark]`;
    let darkInLight = `${rootSelector} [data-test-light-island] [data-test-dark-island-in-light]`;
    assert.strictEqual(
      computedProperty(lightInDark, '--primary'),
      SOFT_POP_ROOT_VARS.primary,
      'a light island inside a dark island resolves the root variables',
    );
    assert.strictEqual(
      computedProperty(lightInDark, '--canvas'),
      BOXEL_CANVAS_LIGHT,
      'a token the theme omits resolves to the light default there',
    );
    assertChromeKnobsReset(assert, lightInDark);
    assert.strictEqual(
      computedProperty(darkInLight, '--primary'),
      SOFT_POP_DARK_VARS.primary,
      'a `dark` class island inside a light island resolves the dark variables',
    );
    assert.strictEqual(
      computedProperty(darkInLight, '--canvas'),
      BOXEL_CANVAS_DARK,
      'a token the theme omits resolves to the dark default there',
    );
    assertChromeKnobsReset(assert, darkInLight);
  });

  test('a nested themed card follows the surrounding island with its own palette', async function (assert) {
    let cardId = `${testRealmURL}scheme-island`;
    let nestedId = `${testRealmURL}scheme-island-nested`;
    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    let rootSelector = `[data-test-card="${cardId}"] [data-test-scheme-island-root]`;
    let inDark = `${rootSelector} [data-test-dark-island] [data-test-card="${nestedId}"] [data-test-nested-embedded]`;
    let inLight = `${rootSelector} [data-test-light-island] [data-test-card="${nestedId}"] [data-test-nested-embedded]`;
    assert.strictEqual(
      computedProperty(inDark, '--primary'),
      MEADOW_DARK_VARS.primary,
      'inside the dark island the nested card resolves its own dark palette',
    );
    assert.strictEqual(
      computedProperty(inDark, '--background'),
      MEADOW_DARK_VARS.background,
      'the nested dark background comes from the nested theme',
    );
    assert.strictEqual(
      computedProperty(inLight, '--primary'),
      MEADOW_THEME_VARS.primary,
      'inside the light island the nested card resolves its own root palette',
    );
    assert.strictEqual(
      computedProperty(inLight, '--background'),
      MEADOW_THEME_VARS.background,
      'the nested light background comes from the nested theme',
    );
  });

  test('an island stamped by a nested themed card gets the nested theme, not the outer one', async function (assert) {
    let cardId = `${testRealmURL}scheme-island`;
    let nestedId = `${testRealmURL}scheme-island-nested`;
    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
    });
    let rootSelector = `[data-test-card="${cardId}"] [data-test-scheme-island-root]`;
    // the light island is the interesting position: the outer theme's dark
    // island rule would repaint this element if it reached past the nested
    // card's boundary
    let stamped = `${rootSelector} [data-test-light-island] [data-test-card="${nestedId}"] [data-test-nested-stamped-island]`;
    assert.strictEqual(
      computedProperty(stamped, '--primary'),
      MEADOW_DARK_VARS.primary,
      'the stamped island resolves the nested theme dark palette',
    );
    assert.strictEqual(
      computedProperty(stamped, '--background'),
      MEADOW_DARK_VARS.background,
      'the stamped island background comes from the nested theme',
    );
    assert.strictEqual(
      computedProperty(stamped, '--accent'),
      MEADOW_THEME_VARS.accent,
      'a token the nested theme defines only at the root keeps its value in the dark island, as on a dark card root',
    );
    assert.notStrictEqual(
      MEADOW_DARK_VARS.primary,
      SOFT_POP_DARK_VARS.primary,
      'the two dark palettes differ, so the assertion above rules out a leak',
    );
    assertChromeKnobsReset(assert, stamped);
  });
});
