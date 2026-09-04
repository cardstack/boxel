import { module, test } from 'qunit';

// theme.css re-declares the light contract on every `[data-boxel-theme-scope]`
// boundary so token values can't inherit into a themed card. Under a dark
// scheme the same boundary must re-declare the dark contract instead, or a
// themed card that omits a token renders it light inside a dark page. CSS has
// no way to share the declaration block between the `.dark` rule and the
// boundary rule, so these tests hold the two copies together.

const DARK_SELECTOR = ".dark, [data-theme='dark']";
const BOUNDARY_SELECTOR = ':where([data-boxel-theme-scope])';
const SCHEME_SIGNAL = '--boxel-color-scheme';

// browsers re-serialize selectorText (Chromium switches attribute values to
// double quotes), so compare a normalized form rather than the source text
function normalizeSelector(selector: string): string {
  return selector.replace(/"/g, "'").replace(/\s+/g, ' ').trim();
}

function matchesSelector(rule: CSSStyleRule, selector: string): boolean {
  return normalizeSelector(rule.selectorText) === normalizeSelector(selector);
}

function customProperties(rule: CSSStyleRule): string[] {
  return Array.from(rule.style).filter((name) => name.startsWith('--'));
}

function findRule(
  rules: CSSRuleList,
  predicate: (rule: CSSStyleRule) => boolean,
): CSSStyleRule | undefined {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule && predicate(rule)) {
      return rule;
    }
    if ('cssRules' in rule) {
      const nested = findRule((rule as CSSGroupingRule).cssRules, predicate);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function findThemeRule(
  predicate: (rule: CSSStyleRule) => boolean,
): CSSStyleRule | undefined {
  for (const sheet of Array.from(document.styleSheets)) {
    const rule = findRule(sheet.cssRules, predicate);
    if (rule) {
      return rule;
    }
  }
  return undefined;
}

module('Unit | theme dark boundary', function () {
  test('the dark boundary reset declares the same tokens as the dark block', function (assert) {
    const darkRule = findThemeRule((rule) =>
      matchesSelector(rule, DARK_SELECTOR),
    );
    const boundaryRule = findThemeRule(
      (rule) =>
        matchesSelector(rule, BOUNDARY_SELECTOR) &&
        rule.parentRule instanceof CSSContainerRule,
    );
    assert.ok(darkRule, `found the ${DARK_SELECTOR} rule`);
    assert.ok(boundaryRule, 'found the dark boundary rule');
    if (!darkRule || !boundaryRule) {
      return;
    }

    const expected = customProperties(darkRule).filter(
      (name) => name !== SCHEME_SIGNAL,
    );
    const actual = customProperties(boundaryRule);
    assert.deepEqual(
      actual.sort(),
      expected.sort(),
      'both dark blocks declare the same custom properties',
    );
    assert.false(
      actual.includes(SCHEME_SIGNAL),
      `${SCHEME_SIGNAL} keeps inheriting through the boundary`,
    );
    for (const name of expected) {
      assert.strictEqual(
        boundaryRule.style.getPropertyValue(name),
        darkRule.style.getPropertyValue(name),
        `${name} has the same value in both dark blocks`,
      );
    }
  });

  test('a themed card in a dark subtree keeps the dark defaults for tokens its theme omits', function (assert) {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('data-theme', 'dark');
    const card = document.createElement('div');
    card.setAttribute('data-boxel-theme-scope', 'probe');
    wrapper.append(card);
    document.body.append(wrapper);
    try {
      const wrapperStyle = getComputedStyle(wrapper);
      const cardStyle = getComputedStyle(card);
      for (const name of ['--background', '--canvas', '--inset', '--field']) {
        assert.strictEqual(
          cardStyle.getPropertyValue(name),
          wrapperStyle.getPropertyValue(name),
          `${name} resolves to the dark default inside the boundary`,
        );
      }
    } finally {
      wrapper.remove();
    }
  });

  test('a light-forced themed card inside a dark subtree stays light', function (assert) {
    const dark = document.createElement('div');
    dark.setAttribute('data-theme', 'dark');
    const light = document.createElement('div');
    light.setAttribute('data-theme', 'light');
    const card = document.createElement('div');
    card.setAttribute('data-boxel-theme-scope', 'probe');
    light.append(card);
    dark.append(light);
    document.body.append(dark);
    try {
      assert.strictEqual(
        getComputedStyle(card).getPropertyValue('--canvas'),
        getComputedStyle(light).getPropertyValue('--canvas'),
        'the boundary follows the nearest scheme switch, not the outer dark ancestor',
      );
    } finally {
      dark.remove();
    }
  });
});
