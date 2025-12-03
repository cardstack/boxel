import { click, fillIn } from '@ember/test-helpers';

import window from 'ember-window-mock';
import { module, test } from 'qunit';

import { dasherize } from '@cardstack/boxel-ui/helpers';

import { Deferred } from '@cardstack/runtime-common';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  setupAuthEndpoints,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  testRealmURL,
  type TestContextWithSave,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const ROOT_CSS_VARS = {
  background: '#0a0f23',
  foreground: '#f4f1e8',
  primary: '#ffd700',
  primaryForeground: '#0a0f23',
  secondary: '#2d3561',
  secondaryForeground: '#c5c2b0',
  destructive: '#cd5c5c',
  destructiveForeground: '#f4f1e8',
  muted: '#1e2347',
  mutedForeground: '#8a8772',
  accent: '#ffb347',
  accentForeground: '#1a1f3a',
  card: '#1a1f3a',
  cardForeground: '#e8e5d3',
  ring: '#ffd700',
  input: '#2d3561',
  popover: '#242952',
  popoverForeground: '#f4f1e8',
  sidebar: '#0f1428',
  sidebarForeground: '#c5c2b0',
  border: '#3a4073',
  fontMono: "'Source Code Pro', 'Courier New', monospace",
  fontSans: "'Libre Baskerville', 'Georgia', serif",
  fontSerif: "'Crimson Text', 'Times New Roman', serif",
  spacing: '0.3rem',
  trackingNormal: '0.01em',
  radius: '0.75rem',
  shadow: '0 6px 12px rgba(255, 215, 0, 0.3)',
  shadow2xl: '0 6px 12px rgba(255, 215, 0, 0.5)',
  chart1: '#ffb347',
};

const DARK_MODE_VARS = {
  background: '#050813',
  foreground: '#f7f4e9',
  primary: '#ffef94',
  primaryForeground: '#050813',
  secondary: '#1e2347',
  secondaryForeground: '#d0cd98',
  accent: '#ffc975',
  accentForeground: '#0f1428',
  muted: '#141933',
  mutedForeground: '#9d9a85',
  destructive: '#e07a7a',
  destructiveForeground: '#f7f4e9',
  card: '#0f1428',
  cardForeground: '#ebe8d5',
  popover: '#1a1f3a',
  popoverForeground: '#f7f4e9',
  sidebar: '#050813',
  sidebarForeground: '#d0cd98',
  ring: '#ffef94',
  input: '#1e2347',
  border: '#2d3561',
  radius: '0.75rem',
  shadow: '0 6px 12px rgba(255, 239, 148, 0.35)',
  spacing: '0.3rem',
  fontMono: "'Source Code Pro', 'Courier New', monospace",
  fontSans: "'Libre Baskerville', 'Georgia', serif",
  fontSerif: "'Crimson Text', 'Times New Roman', serif",
  trackingNormal: '0.01em',
};

const ROOT_STYLE_ATTRS = Object.entries(ROOT_CSS_VARS)
  .sort()
  .map(([key, val]) => [`--${dasherize(key)}`, val].join(': '))
  .join('; ');

const SOFT_POP_VARS = `:root {
  --background: oklch(0.9789 0.0082 121.6272);
  --foreground: oklch(0 0 0);
  --card: oklch(1.0000 0 0);
  --card-foreground: oklch(0 0 0);
  --popover: oklch(1.0000 0 0);
  --popover-foreground: oklch(0 0 0);
  --primary: oklch(0.5106 0.2301 276.9656);
  --primary-foreground: oklch(1.0000 0 0);
  --secondary: oklch(0.7038 0.1230 182.5025);
  --secondary-foreground: oklch(1.0000 0 0);
  --muted: oklch(0.9551 0 0);
  --muted-foreground: oklch(0.3211 0 0);
  --accent: oklch(0.7686 0.1647 70.0804);
  --accent-foreground: oklch(0 0 0);
  --destructive: oklch(0.6368 0.2078 25.3313);
  --destructive-foreground: oklch(1.0000 0 0);
  --border: oklch(0 0 0);
  --input: oklch(0.5555 0 0);
  --ring: oklch(0.7853 0.1041 274.7134);
  --font-sans: DM Sans, sans-serif;
  --font-serif: DM Sans, sans-serif;
  --font-mono: Space Mono, monospace;
  --radius: 1rem;
  --tracking-normal: normal;
  --spacing: 0.25rem;
  }

  .dark {
    --background: oklch(0 0 0);
    --foreground: oklch(1.0000 0 0);
    --card: oklch(0.2455 0.0217 257.2823);
    --card-foreground: oklch(1.0000 0 0);
    --popover: oklch(0.2455 0.0217 257.2823);
    --popover-foreground: oklch(1.0000 0 0);
    --primary: oklch(0.6801 0.1583 276.9349);
    --primary-foreground: oklch(0 0 0);
    --secondary: oklch(0.7845 0.1325 181.9120);
    --secondary-foreground: oklch(0 0 0);
    --muted: oklch(0.3211 0 0);
    --muted-foreground: oklch(0.8452 0 0);
    --accent: oklch(0.8790 0.1534 91.6054);
    --accent-foreground: oklch(0 0 0);
    --destructive: oklch(0.7106 0.1661 22.2162);
    --destructive-foreground: oklch(0 0 0);
    --border: oklch(0.4459 0 0);
    --input: oklch(1.0000 0 0);
    --ring: oklch(0.6801 0.1583 276.9349);
    --font-sans: DM Sans, sans-serif;
    --font-serif: DM Sans, sans-serif;
    --font-mono: Space Mono, monospace;
    --radius: 1rem;
    --shadow: 0px 0px 0px 0px hsl(0 0% 10.1961% / 0.05), 0px 1px 2px -1px hsl(0 0% 10.1961% / 0.05);
}`;

module('Acceptance | theme-card-test', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  let { createAndJoinRoom } = mockMatrixUtils;
  const themeCardId = `${testRealmURL}starry-night`;
  const softPopCardId = `${testRealmURL}soft-pop`;
  const styleRefCardId = `${testRealmURL}style-ref-starry-night`;

  hooks.beforeEach(async function () {
    createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        '.realm.json': {
          name: 'Theme Playground',
        },
        'starry-night.json': {
          data: {
            meta: {
              adoptsFrom: {
                name: 'default',
                module: 'https://cardstack.com/base/structured-theme',
              },
            },
            type: 'card',
            attributes: {
              cardInfo: {
                title: 'Starry Night',
                description: 'A celestial theme',
                thumbnailURL:
                  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=400&auto=format&fit=crop',
              },
              cssImports: [
                'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
                'https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap',
                'https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
              ],
              rootVariables: ROOT_CSS_VARS,
              darkModeVariables: DARK_MODE_VARS,
            },
          },
        },
        'style-ref-starry-night.json': {
          data: {
            meta: {
              adoptsFrom: {
                name: 'default',
                module: 'https://cardstack.com/base/style-reference',
              },
            },
            type: 'card',
            attributes: {
              cardInfo: {
                notes:
                  'Color palette extracted from the famous painting: deep Prussian blue (#0a0f23), golden yellow (#ffd700), warm amber (#ffb347), and creamy highlights (#f4f1e8). Uses elegant serif fonts to match the artistic, classical nature of the inspiration.',
                title: 'Starry Night',
                description:
                  "A celestial theme inspired by Van Gogh's masterpiece, featuring deep midnight blues swirling with golden yellows and warm amber accents.",
                thumbnailURL:
                  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=400&auto=format&fit=crop',
              },
              styleName: 'Starry Night',
              visualDNA:
                "A celestial theme inspired by Van Gogh's masterpiece, featuring deep midnight blues swirling with golden yellows and warm amber accents. The palette captures the cosmic energy of a starlit night with flowing, organic movements and luminous highlights that dance across dark surfaces.",
              cssImports: [
                'https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&display=swap',
                'https://fonts.googleapis.com/css2?family=Crimson+Text:ital,wght@0,400;0,600;1,400&display=swap',
                'https://fonts.googleapis.com/css2?family=Source+Code+Pro:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap',
              ],
              inspirations: [
                'Van Gogh',
                'Post-Impressionism',
                'Cosmic swirls',
                'Night sky',
                'Cypress trees',
                'Village lights',
                'Impasto technique',
                'Dynamic brushstrokes',
              ],
              rootVariables: ROOT_CSS_VARS,
              wallpaperImages: [
                'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=1200&auto=format&fit=crop',
                'https://images.unsplash.com/photo-1447433589675-4aaa569f3e05?q=80&w=1200&auto=format&fit=crop',
                'https://images.unsplash.com/photo-1419242902214-272b3f66ee7a?q=80&w=1200&auto=format&fit=crop',
              ],
              darkModeVariables: DARK_MODE_VARS,
            },
          },
        },
        'soft-pop.json': {
          data: {
            meta: {
              adoptsFrom: {
                name: 'default',
                module: 'https://cardstack.com/base/structured-theme',
              },
            },
            type: 'card',
            attributes: {
              cardInfo: {
                title: 'Soft Pop',
                description: 'A theme with soft color pops',
              },
            },
          },
        },
      },
    });
  });

  module('style-reference-card', () => {
    test('renders with inline css variables', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: styleRefCardId, format: 'isolated' }]],
      });
      assert
        .dom(`[data-test-card="${styleRefCardId}"] h1`)
        .hasText('Starry Night');
      assert
        .dom(`[data-test-card="${styleRefCardId}"]`)
        .hasClass('boxel-card-container--themed');
      assert
        .dom(`[data-test-card="${styleRefCardId}"]`)
        .hasAttribute('style', ROOT_STYLE_ATTRS);

      let container = document.querySelector<HTMLElement>(
        `[data-test-card="${styleRefCardId}"]`,
      );
      assert.ok(container, 'theme card container is present');
      let computedFontFamily = window
        .getComputedStyle(container!)
        .getPropertyValue('font-family');
      assert.ok(
        computedFontFamily.includes('Libre Baskerville'),
        `computed font-family includes themed value`,
      );
    });
  });

  module('structured-theme-card', () => {
    test('renders with inline css variables', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: themeCardId, format: 'isolated' }]],
      });
      assert
        .dom(`[data-test-card="${themeCardId}"] h1`)
        .hasText('Starry Night');
      assert.dom('[data-test-css-vars]').containsText('--radius: 0.75rem;');
      assert
        .dom(`[data-test-card="${themeCardId}"]`)
        .hasClass('boxel-card-container--themed');
      assert
        .dom(`[data-test-card="${themeCardId}"]`)
        .hasAttribute('style', ROOT_STYLE_ATTRS);

      let container = document.querySelector<HTMLElement>(
        `[data-test-card="${themeCardId}"]`,
      );
      assert.ok(container, 'theme card container is present');
      let styleAttr = container?.getAttribute('style') ?? '';
      assert.ok(
        styleAttr.includes('--background: #0a0f23'),
        'inline style includes root background variable',
      );
      assert.ok(
        styleAttr.includes('--chart-1: #ffb347'),
        'inline style includes root chart-1 variable',
      );
      assert.ok(
        styleAttr.includes('--shadow-2xl: 0 6px 12px rgba(255, 215, 0, 0.5)'),
        'inline style includes root shadow-2x variable',
      );
      assert.false(
        styleAttr.includes('--background: #050813'),
        'dark mode value is not applied inline',
      );
      let computedFontFamily = window
        .getComputedStyle(container!)
        .getPropertyValue('font-family');
      assert.ok(
        computedFontFamily.includes('Libre Baskerville'),
        `computed font-family includes themed value`,
      );

      await visitOperatorMode({
        stacks: [],
        codePath: themeCardId,
        submode: 'code',
      });
      assert
        .dom(`[data-test-card="${themeCardId}"] h1`)
        .hasText('Starry Night');
      assert.dom('[data-test-css-vars]').containsText('--radius: 0.75rem;');
      assert
        .dom(`[data-test-card="${themeCardId}"]`)
        .hasAttribute('style', ROOT_STYLE_ATTRS);

      await percySnapshot(assert);
    });

    test<TestContextWithSave>('applies pasted custom CSS variables', async function (assert) {
      assert.expect(12);

      await visitOperatorMode({
        stacks: [[{ id: softPopCardId, format: 'isolated' }]],
      });

      let deferred = new Deferred<void>();
      this.onSave((url, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(url.href, softPopCardId);
        assert.strictEqual(
          json?.data.attributes?.rootVariables?.primary,
          'oklch(0.5106 0.2301 276.9656)',
          'primary root var is saved',
        );
        assert.strictEqual(
          json?.data.attributes?.rootVariables?.fontSans,
          'DM Sans, sans-serif',
          'font-sans root var is saved',
        );
        assert.strictEqual(
          json?.data.attributes?.darkModeVariables?.foreground,
          'oklch(1.0000 0 0)',
          'dark foreground is saved',
        );
        deferred.fulfill();
      });

      assert.dom('[data-test-css-vars]').containsText('No CSS defined');

      await fillIn('[data-test-custom-css-variables]', SOFT_POP_VARS);

      assert
        .dom('[data-test-root-vars] [data-test-var-value="secondary"]')
        .containsText('oklch(0.7038 0.1230 182.5025)');
      assert
        .dom('[data-test-dark-vars] [data-test-var-value="muted"]')
        .containsText('oklch(0.3211 0 0)');
      assert
        .dom('[data-test-css-vars]')
        .containsText('--background: oklch(0.9789 0.0082 121.6272);');
      assert
        .dom('[data-test-css-vars]')
        .containsText('--background: oklch(0 0 0);');

      await click('[data-test-edit-button]');

      assert
        .dom(
          '[data-test-field="rootVariables"] [data-test-field="accent"] [data-test-swatch="oklch(0.7686 0.1647 70.0804)"]',
        )
        .exists();
      assert
        .dom(
          '[data-test-field="rootVariables"] [data-test-field="accent"] [data-test-color-text-input]',
        )
        .hasValue('oklch(0.7686 0.1647 70.0804)');
      assert
        .dom(
          '[data-test-field="darkModeVariables"] [data-test-field="accent"] [data-test-color-text-input]',
        )
        .hasValue('oklch(0.8790 0.1534 91.6054)');
    });

    test<TestContextWithSave>('updates CSS variables when editing textarea values', async function (assert) {
      assert.expect(16);

      await visitOperatorMode({
        stacks: [[{ id: themeCardId, format: 'isolated' }]],
      });

      let deferred = new Deferred<void>();
      this.onSave((url, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(url.href, themeCardId);
        const rootVars = json?.data.attributes?.rootVariables;
        const darkVars = json?.data.attributes?.darkModeVariables;
        assert.strictEqual(
          rootVars?.background,
          '#455A68',
          'background value is updated',
        );
        assert.strictEqual(
          rootVars?.foreground,
          '#FCD2A7',
          'foreground value is updated',
        );
        assert.strictEqual(
          rootVars?.card,
          '#1a1f3a',
          'card value did not change',
        );
        assert.strictEqual(
          darkVars?.background,
          '#050813',
          'dark background did not change',
        );
        assert.strictEqual(
          darkVars?.card,
          'black',
          'dark card background is updated',
        );
        deferred.fulfill();
      });

      assert
        .dom('[data-test-root-vars] [data-test-var-value="background"]')
        .containsText('#0a0f23');
      assert
        .dom('[data-test-root-vars] [data-test-var-value="card"]')
        .containsText('#1a1f3a');
      assert
        .dom('[data-test-dark-vars] [data-test-var-value="background"]')
        .containsText('#050813');

      await fillIn(
        '[data-test-custom-css-variables]',
        ':root { --background: #455A68; --foreground: #FCD2A7; } .dark { --card: black; }',
      );

      assert
        .dom('[data-test-root-vars] [data-test-var-value="background"]')
        .containsText('#455A68', 'value is updated');
      assert
        .dom('[data-test-root-vars] [data-test-var-value="card"]')
        .containsText('#1a1f3a', 'existing value remains');
      assert.dom('[data-test-css-vars]').containsText('--background: #455A68;');
      assert.dom('[data-test-css-vars]').containsText('--card: #1a1f3a;');

      await click('[data-test-edit-button]');

      assert
        .dom(
          '[data-test-field="rootVariables"] [data-test-field="foreground"] [data-test-color-text-input]',
        )
        .hasValue('#FCD2A7', 'foreground is updated in edit mode');
      assert
        .dom(
          '[data-test-field="darkModeVariables"] [data-test-field="card"] [data-test-color-text-input]',
        )
        .hasValue('black', 'dark card background is updated in edit mode');
      assert
        .dom(
          '[data-test-field="darkModeVariables"] [data-test-field="background"] [data-test-color-text-input]',
        )
        .hasValue('#050813', 'existing value remains in edit mode');
    });

    test<TestContextWithSave>('recomputes cssVariables after editing fields', async function (assert) {
      assert.expect(4);

      const NEW_FOREGROUND = '#a6f4ca';

      await visitOperatorMode({
        stacks: [[{ id: themeCardId, format: 'edit' }]],
      });

      let deferred = new Deferred<void>();

      this.onSave((url, json) => {
        if (typeof json === 'string') {
          throw new Error('expected JSON save data');
        }
        assert.strictEqual(url.href, themeCardId);
        const rootVars = json?.data.attributes?.rootVariables;
        assert.strictEqual(
          rootVars?.background,
          '#0a0f23',
          'background value did not change',
        );
        assert.strictEqual(
          rootVars?.foreground,
          NEW_FOREGROUND,
          'foreground value is updated',
        );
        deferred.fulfill();
      });

      await fillIn(
        '[data-test-field="rootVariables"] [data-test-field="foreground"] [data-test-boxel-input]',
        NEW_FOREGROUND,
      );

      await visitOperatorMode({
        stacks: [[{ id: themeCardId, format: 'isolated' }]],
      });

      assert
        .dom('[data-test-css-vars]')
        .containsText(` --foreground: ${NEW_FOREGROUND}; `);
    });
  });
});
