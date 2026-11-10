/**
 * The gallery shell's own palette and type: a gallery card that no theme card
 * reaches still renders in theme.json's values, in both schemes, and a theme
 * card that is applied still paints over them.
 */
import { settled } from '@ember/test-helpers';

import { module, test } from 'qunit';

import { parseCssGroups } from '@cardstack/boxel-ui/helpers';

import { setupChoreoGalleryTest } from '../helpers/choreo-gallery-stage';
import { renderCard } from '../helpers/render-component';

import type * as ThemeModule from '../../../choreo-gallery/realm/lib/theme';
import type * as CardAPI from '@cardstack/base/card-api';

const SCHEMES = ['dark', 'light'] as const;
const DEMO = 'keyframes';

/**
 * The typography role variable the card container derives from a theme's
 * `--theme-<role>-*` variable, which the gallery's components read: the label
 * role is `--boxel-ui-label-*`, and every other role keeps its name.
 */
function roleVariable(themeVariable: string): string {
  return themeVariable
    .replace(/^--theme-label-/, '--boxel-ui-label-')
    .replace(/^--theme-/, '--boxel-');
}

function site(): HTMLElement {
  return document.querySelector<HTMLElement>('[data-choreo-site]')!;
}

/** the computed value of each custom property on the shell's root */
function resolved(names: string[]): Record<string, string> {
  let style = getComputedStyle(site());
  return Object.fromEntries(
    names.map((name) => [name, style.getPropertyValue(name).trim()]),
  );
}

module('Integration | Choreo gallery | theme fallback', function (hooks) {
  let gallery = setupChoreoGalleryTest(hooks);

  hooks.afterEach(async function () {
    let { setThemeMode } =
      await gallery.import<typeof ThemeModule>('lib/theme');
    setThemeMode('dark');
  });

  async function setScheme(scheme: 'dark' | 'light') {
    let { setThemeMode } =
      await gallery.import<typeof ThemeModule>('lib/theme');
    setThemeMode(scheme);
    await settled();
  }

  /** render the demo's page with `theme` linked, or with no theme */
  async function renderDemo(theme: CardAPI.CardDef | null) {
    let { CardInfoField } = await gallery.loader.import<typeof CardAPI>(
      '@cardstack/base/card-api',
    );
    let [demo] = await gallery.demos([DEMO]);
    demo!.cardInfo = new CardInfoField(theme ? { theme } : {});
    await renderCard(gallery.loader, demo!, 'isolated');
  }

  test('a demo with no theme linked resolves every value the gallery theme sets, in each scheme', async function (assert) {
    let theme = (await gallery.theme()) as CardAPI.Theme;
    let groups = parseCssGroups(theme.cssVariables);
    let themeNames = [
      ...new Set(
        [':root', '.dark'].flatMap((selector) => [
          ...(groups?.get(selector)?.keys() ?? []),
        ]),
      ),
    ].filter((name) => name.startsWith('--'));
    // a role the theme sets reaches the gallery as the container's role
    // variable, so the shell has to resolve that the same way too
    let names = themeNames.concat(
      themeNames
        .filter((name) => name.startsWith('--theme-'))
        .map(roleVariable),
    );
    assert.true(
      [
        '--foreground',
        '--background',
        '--copper',
        '--iris-ink',
        '--boxel-eyebrow-font-size',
      ].every((name) => names.includes(name)),
      'the theme sets the contract tokens, the gallery’s own and its eyebrow role',
    );

    let themed: Record<string, Record<string, string>> = {};
    await renderDemo(theme);
    for (let scheme of SCHEMES) {
      await setScheme(scheme);
      themed[scheme] = resolved(names);
    }

    await renderDemo(null);
    for (let scheme of SCHEMES) {
      await setScheme(scheme);
      assert.deepEqual(
        resolved(names),
        themed[scheme],
        `${scheme}: the same values as under the theme card`,
      );
    }
  });

  test('a demo with no theme linked paints its ground and text in the gallery’s palette', async function (assert) {
    // each scheme is set before its render: the shell eases its color and
    // ground across a scheme switch, so a switch after the render would be
    // read mid-transition
    await setScheme('dark');
    await renderDemo(null);
    let style = getComputedStyle(site());
    assert.strictEqual(style.color, 'rgb(243, 236, 227)', 'dark: cream ink');
    assert.strictEqual(
      style.backgroundColor,
      'rgb(46, 41, 36)',
      'on the charcoal ground',
    );

    await setScheme('light');
    await renderDemo(null);
    style = getComputedStyle(site());
    assert.strictEqual(style.color, 'rgb(33, 29, 24)', 'light: charcoal ink');
    assert.strictEqual(
      style.backgroundColor,
      'rgb(242, 236, 225)',
      'on the cream ground',
    );
  });

  test('a theme card paints over the fallback, in each scheme', async function (assert) {
    let theme = await gallery.buildTheme((attributes) => {
      attributes.rootVariables.foreground = '#102030';
      attributes.darkModeVariables.foreground = '#e0f0ff';
      attributes.darkModeVariables.primaryInk = '#7fb4f0';
      let iris = attributes.customCssVariables.find(
        ({ name }) => name === 'iris-ink',
      )!;
      iris.value = '#203040';
      iris.darkValue = '#c0d0e0';
      attributes.typography['eyebrow']!['fontSize'] = '13px';
    });
    await renderDemo(theme);

    await setScheme('dark');
    assert.deepEqual(
      resolved([
        '--foreground',
        '--primary-ink',
        '--iris-ink',
        '--boxel-eyebrow-font-size',
      ]),
      {
        '--foreground': '#e0f0ff',
        '--primary-ink': '#7fb4f0',
        '--iris-ink': '#c0d0e0',
        '--boxel-eyebrow-font-size': '13px',
      },
      'dark: the theme’s contract tokens, custom variables and eyebrow',
    );

    await setScheme('light');
    assert.deepEqual(
      resolved(['--foreground', '--iris-ink', '--boxel-eyebrow-font-size']),
      {
        '--foreground': '#102030',
        '--iris-ink': '#203040',
        '--boxel-eyebrow-font-size': '13px',
      },
      'light: the same',
    );
  });
});
