import window from 'ember-window-mock';
import { module, test } from 'qunit';

import {
  percySnapshot,
  setupLocalIndexing,
  setupOnSave,
  setupUserSubscription,
  setupAuthEndpoints,
  setupAcceptanceTestRealm,
  visitOperatorMode,
  testRealmURL,
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

const ROOT_STYLE_ATTRS =
  "--background: #0a0f23; --foreground: #f4f1e8; --card: #1a1f3a; --card-foreground: #e8e5d3; --popover: #242952; --popover-foreground: #f4f1e8; --primary: #ffd700; --primary-foreground: #0a0f23; --secondary: #2d3561; --secondary-foreground: #c5c2b0; --muted: #1e2347; --muted-foreground: #8a8772; --accent: #ffb347; --accent-foreground: #1a1f3a; --destructive: #cd5c5c; --destructive-foreground: #f4f1e8; --border: #3a4073; --input: #2d3561; --ring: #ffd700; --sidebar: #0f1428; --sidebar-foreground: #c5c2b0; --font-sans: 'Libre Baskerville', 'Georgia', serif; --font-serif: 'Crimson Text', 'Times New Roman', serif; --font-mono: 'Source Code Pro', 'Courier New', monospace; --radius: 0.75rem; --spacing: 0.3rem; --tracking-normal: 0.01em; --shadow: 0 6px 12px rgba(255, 215, 0, 0.3)";

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
      },
    });
  });

  test('renders structured theme card with inline css variables', async function (assert) {
    assert.expect(11);
    await visitOperatorMode({
      stacks: [[{ id: themeCardId, format: 'isolated' }]],
    });
    assert.dom(`[data-test-card="${themeCardId}"] h1`).hasText('Starry Night');
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
    assert.dom(`[data-test-card="${themeCardId}"] h1`).hasText('Starry Night');
    assert.dom('[data-test-css-vars]').containsText('--radius: 0.75rem;');
    assert
      .dom(`[data-test-card="${themeCardId}"]`)
      .hasAttribute('style', ROOT_STYLE_ATTRS);

    await percySnapshot(assert);
  });

  test('renders StyleReference theme card with inline css variables', async function (assert) {
    assert.expect(5);
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
