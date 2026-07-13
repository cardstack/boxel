import { module, test } from 'qunit';

import { ThemeStyleDeduper } from '@cardstack/host/lib/theme-style-deduper';

const LIGHT_CSS =
  '[data-boxel-theme-scope="https://example.test/theme-abc"]{--primary: #112233;}';
// a dark-only theme's stylesheet starts with @container, not the scope
// selector — recognition must not depend on the CSS text's leading output
const DARK_ONLY_CSS =
  '@container style(--boxel-color-scheme: dark){[data-boxel-theme-scope="https://example.test/theme-def"]{--primary: #445566;}}';

module('Unit | theme-style-deduper', function (hooks) {
  let deduper: ThemeStyleDeduper;
  let fixture: HTMLElement;

  hooks.beforeEach(function () {
    deduper = new ThemeStyleDeduper();
    fixture = document.createElement('div');
    document.body.appendChild(fixture);
  });

  hooks.afterEach(function () {
    deduper.stop();
    fixture.remove();
  });

  function addThemeStyle(css: string): HTMLStyleElement {
    let el = document.createElement('style');
    el.setAttribute('data-boxel-theme-style', '');
    el.textContent = css;
    fixture.appendChild(el);
    return el;
  }

  function flush(): Promise<void> {
    // the deduper coalesces mutations into a microtask; one macrotask hop
    // guarantees the scheduled #sync has run
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  test('keeps one copy of each identical theme stylesheet active', async function (assert) {
    let first = addThemeStyle(LIGHT_CSS);
    let second = addThemeStyle(LIGHT_CSS);
    deduper.start();
    assert.false(first.disabled, 'first copy stays active');
    assert.true(second.disabled, 'duplicate copy is disabled');
  });

  test('dedupes dark-only theme stylesheets', async function (assert) {
    deduper.start();
    let first = addThemeStyle(DARK_ONLY_CSS);
    let second = addThemeStyle(DARK_ONLY_CSS);
    await flush();
    assert.false(first.disabled, 'first dark-only copy stays active');
    assert.true(second.disabled, 'duplicate dark-only copy is disabled');
  });

  test('non-identical stylesheets are never disabled', async function (assert) {
    deduper.start();
    let light = addThemeStyle(LIGHT_CSS);
    let dark = addThemeStyle(DARK_ONLY_CSS);
    await flush();
    assert.false(light.disabled);
    assert.false(dark.disabled);
  });

  test('ignores style elements without the marker attribute', async function (assert) {
    deduper.start();
    let unmarked = document.createElement('style');
    unmarked.textContent = LIGHT_CSS;
    fixture.appendChild(unmarked);
    let duplicate = unmarked.cloneNode(true) as HTMLStyleElement;
    fixture.appendChild(duplicate);
    await flush();
    assert.false(unmarked.disabled);
    assert.false(duplicate.disabled);
  });

  test('promotes a survivor when the active copy is removed', async function (assert) {
    deduper.start();
    let first = addThemeStyle(LIGHT_CSS);
    let second = addThemeStyle(LIGHT_CSS);
    await flush();
    assert.true(second.disabled, 'duplicate starts disabled');
    first.remove();
    await flush();
    assert.false(second.disabled, 'survivor is re-enabled');
  });

  test('stop re-enables everything', async function (assert) {
    deduper.start();
    addThemeStyle(LIGHT_CSS);
    let second = addThemeStyle(LIGHT_CSS);
    await flush();
    assert.true(second.disabled);
    deduper.stop();
    assert.false(second.disabled, 'stop re-enables disabled copies');
  });
});
