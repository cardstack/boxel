import { module, test } from 'qunit';

import {
  confineCapsuleStylesheet,
  networkBearingCSS,
  validateCapsuleInlineStyle,
  validateCapsuleStylesheet,
  validateSharedDocumentScopedCSSRequest,
} from '@cardstack/host/lib/capsule-css-policy';

module('Unit | Capsule CSS policy', function () {
  test('admits literal declarations and rejects network-bearing spellings', function (assert) {
    assert.strictEqual(
      validateCapsuleInlineStyle(
        'color: rgb(10 20 30); transform: translateX(1rem)',
      ),
      'color: rgb(10 20 30); transform: translateX(1rem)',
    );

    for (let style of [
      'background: url(https://attacker.example/pixel)',
      'background: u\\72l(https://attacker.example/escaped)',
      'background: image-set(url(https://attacker.example/a) 1x)',
      '@import "https://attacker.example/style.css"',
    ]) {
      assert.throws(
        () => validateCapsuleInlineStyle(style),
        /network-bearing value/,
        style,
      );
    }
  });

  test('admits compiled scoped CSS but denies global and network authority', function (assert) {
    let scoped = '.card[data-scopedcss-a1b2c3] { color: rgb(10 20 30); }';
    assert.strictEqual(validateCapsuleStylesheet(scoped), scoped);
    assert.throws(
      () => validateCapsuleStylesheet('.card { color: red; }'),
      /selector escaped its compiled scope/,
    );
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          '@import "https://attacker.example/x"; .card[data-scopedcss-a] {}',
        ),
      /network-bearing value/,
    );
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          '.card[data-scopedcss-a] { background: u\\72l(https://attacker.example/x); }',
        ),
      /network-bearing value/,
    );
  });

  test('requires every shared-document selector to remain anchored by its compiled scope', function (assert) {
    let scoped = '[data-scopedcss-card-template]';
    let safe = `
      ${scoped}, article${scoped}:is(.featured, .selected) { color: rebeccapurple; }
      .metric-value${scoped} * { font-variant-numeric: tabular-nums; }
      .field${scoped} > output { display: block; }
      ${scoped} body { color: rebeccapurple; }
      @media (min-width: 40rem) {
        .summary${scoped} { display: grid; }
      }
      @keyframes pulse-card-template {
        from { opacity: 0.5; }
        to { opacity: 1; }
      }
    `;
    assert.strictEqual(validateCapsuleStylesheet(safe), safe);

    for (let css of [
      'body { color: transparent; }',
      `${scoped}, body { color: transparent; }`,
      `@media (min-width: 1px) { body { color: transparent; } }`,
      `${scoped} ~ * { visibility: hidden; }`,
      `${scoped} + * { visibility: hidden; }`,
      `body:has(${scoped}) { visibility: hidden; }`,
    ]) {
      assert.throws(
        () => validateCapsuleStylesheet(css),
        /selector escaped its compiled scope/,
        css,
      );
    }
  });

  test('rejects document-global registrations from Capsule styles', function (assert) {
    let scoped = '[data-scopedcss-card-template]';
    for (let css of [
      '@font-face { font-family: stolen; src: local(Arial); }',
      '@property --host-color { syntax: "<color>"; inherits: true; initial-value: red; }',
      '@counter-style host-counter { system: cyclic; symbols: x; }',
      '@layer host-reset { body { color: transparent; } }',
      '@layer host-reset, card;',
      `${scoped} { view-transition-name: host-overlay; }`,
      '@font\\-face { font-family: stolen; src: local(Arial); }',
      '@lay\\65 r host-reset { body { color: transparent; } }',
      `${scoped} { view\\-transition-name: host-overlay; }`,
    ]) {
      assert.throws(
        () => validateCapsuleStylesheet(css),
        /document-global rule/,
        css,
      );
    }

    let anonymousLayer = `@layer { .card${scoped} { color: teal; } }`;
    assert.strictEqual(
      validateCapsuleStylesheet(anonymousLayer),
      anonymousLayer,
    );
  });

  test('validates prerendered scoped CSS before its Host registration module runs', function (assert) {
    let safe = scopedCSSRequest(
      '.card[data-scopedcss-card-template] { color: teal; }',
    );
    assert.strictEqual(validateSharedDocumentScopedCSSRequest(safe), safe);

    let escaped = scopedCSSRequest(
      '.card[data-scopedcss-card-template], .operator-mode { font-size: 8rem; }',
    );
    assert.throws(
      () => validateSharedDocumentScopedCSSRequest(escaped),
      /selector escaped its compiled scope/,
    );
  });

  test('exempts a trusted Cardstack component stylesheet from the policy, but still validates an authored one', function (assert) {
    // A trusted component (Base, Catalog, `@cardstack/*` packages such as
    // Boxel UI) is a one-way portal (docs/boxel-execution-runtime-
    // architecture.md, "Trusted Cardstack components are one-way portals"):
    // it executes as a Host-owned component outside Capsule confinement, so
    // its own compiled scoped CSS is Host-trusted styling, never authored
    // content sharing the document. Real trusted components use exactly
    // these shapes for legitimate reasons — a named `@layer` for cascade
    // ordering (`packages/boxel-ui/addon/src/components/card-container/
    // index.gts`'s `@layer reset`) and a `:global()` reset selector that
    // intentionally opts out of scoping (the same file's
    // `:global(.boxel-card-container)`) — neither of which an authored card
    // should ever be able to register in the shared document.
    let namedLayer = scopedCSSRequest(
      '@layer reset { :global(h1) { margin: 0; } }',
      '@cardstack/boxel-ui/components/card-container/index.gts',
    );
    let isTrustedBoxelUI = (moduleIdentifier: string) =>
      moduleIdentifier.startsWith('@cardstack/boxel-ui/');

    assert.strictEqual(
      validateSharedDocumentScopedCSSRequest(namedLayer, isTrustedBoxelUI),
      namedLayer,
      'a trusted origin is exempted from the policy entirely',
    );

    assert.throws(
      () => validateSharedDocumentScopedCSSRequest(namedLayer, () => false),
      /document-global rule/,
      'the identical stylesheet is still rejected when its origin is not trusted',
    );
    assert.throws(
      () => validateSharedDocumentScopedCSSRequest(namedLayer),
      /document-global rule/,
      'omitting the predicate keeps the strict, always-validate behavior for existing callers',
    );
  });

  test('authored theme-aware scoped CSS: legitimate shapes are admitted, escaping ones are still rejected', function (assert) {
    let scoped = '[data-scopedcss-card-template]';

    // `@container style(--boxel-color-scheme: dark)` (the container style
    // query `@cardstack/boxel-ui/helpers/theme-scoped-css.ts` emits for a
    // theme's `.dark` block) is not a document-global registration and does
    // not affect scope anchoring: an authored card is free to nest its own
    // compiled-scope selectors inside one.
    let containerStyleQuery = `
      @container style(--boxel-color-scheme: dark) {
        .heading${scoped} { color: mintcream; }
      }
    `;
    assert.strictEqual(
      validateCapsuleStylesheet(containerStyleQuery),
      containerStyleQuery,
    );

    // `[data-boxel-theme-scope="..."]` (the ambient scope attribute
    // `themeScopedCss` stamps on a themed `CardContainer`) is a legitimate
    // ancestor/context selector for an authored card to react to, as long
    // as the rule's own compiled scope attribute anchors it.
    let themeScopeContext = `[data-boxel-theme-scope] .heading${scoped} { color: mintcream; }`;
    assert.strictEqual(
      validateCapsuleStylesheet(themeScopeContext),
      themeScopeContext,
    );

    // An authored rule with no compiled scope attribute at all — even one
    // keyed off the same theme-scope attribute — still escapes: it would
    // match any themed card sharing the document, not just this card's own
    // subtree, which is exactly what the anchor requirement exists to stop.
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          '[data-boxel-theme-scope] { color: mintcream; }',
        ),
      /selector escaped its compiled scope/,
    );
  });

  test('admits the real theme stylesheet shape `themeScopedCss` generates, declaration-restricted', function (assert) {
    // Verbatim shape from `@cardstack/boxel-ui/helpers/theme-scoped-css.ts`'s
    // `themeScopedCss()`: a runtime-generated stylesheet, never compiled by
    // glimmer-scoped-css, so it can never carry a `[data-scopedcss-*]`
    // attribute. `themeScope()` derives the attribute value from the theme
    // card's identity plus a content fingerprint of its CSS
    // (`<themeId>-<fingerprint>`), so it is unguessable and content-addressed
    // — a card cannot make its own theme collide with another's scope.
    let themeId = '@cardstack/base/Theme/midnight-mint';
    let fingerprint = '4f2c9a01d8b7e653';
    let scopeValue = `${themeId}-${fingerprint}`;
    let light = `[data-boxel-theme-scope="${scopeValue}"]{--accent:#2dd4a7;--background:#ffffff;--foreground:#111111;}`;
    let dark = `@container style(--boxel-color-scheme: dark){[data-boxel-theme-scope="${scopeValue}"]{--background:#0b0f0e;--foreground:#eafaf3;}}`;
    let themeStylesheet = light + dark;

    assert.strictEqual(
      validateCapsuleStylesheet(themeStylesheet),
      themeStylesheet,
      'the light block and its dark @container style() wrapper are both admitted as custom-property-only theme tokens',
    );

    // The same selector shape, but the rule now carries a non-custom-property
    // declaration: still escapes. Acceptance is a token pipe (`--*` only),
    // not a general exemption for any rule anchored by the attribute.
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          `[data-boxel-theme-scope="${scopeValue}"]{--accent:#2dd4a7;color:red;}`,
        ),
      /selector escaped its compiled scope/,
      'a mixed custom-property/standard-property rule is not admitted',
    );

    // Compounding the theme-scope attribute with anything else — a tag, a
    // class, a compiled scope attribute, a combinator — is no longer the
    // generator's own bare selector, so it does not qualify either, even
    // with custom-property-only declarations.
    assert.throws(
      () =>
        validateCapsuleStylesheet(
          `body[data-boxel-theme-scope="${scopeValue}"]{--accent:#2dd4a7;}`,
        ),
      /selector escaped its compiled scope/,
      "a compounded theme-scope selector is not the generator's bare shape",
    );
  });

  test('exports the network-bearing CSS pattern that boxel-source-classifier.ts reuses for Sandbox routing', function (assert) {
    // `boxel-source-classifier.ts` imports this exact pattern to route an
    // authored module's scoped CSS to the Sandbox tier. Every value it
    // matches must also be one `validateCapsuleStylesheet` rejects, or the
    // two layers could drift: a card could be routed to Capsule while
    // carrying a declaration only Sandbox's real document can honor.
    for (let css of [
      '@import "https://fonts.example/inter.css";',
      '.title[data-scopedcss-a] { background: url(https://images.example/bg.png); }',
    ]) {
      assert.true(
        networkBearingCSS.test(css),
        `classifier signal pattern matches: ${css}`,
      );
      assert.throws(
        () => validateCapsuleStylesheet(css),
        /network-bearing value/,
        `policy backstop still rejects: ${css}`,
      );
    }
  });

  test('confines compiled selectors to the Capsule render island', function (assert) {
    let scoped = '[data-scopedcss-card-template]';
    let confined = confineCapsuleStylesheet(`
      ${scoped}, .logo${scoped} { color: teal; }
      @media (min-width: 40rem) {
        svg${scoped} { display: block; }
      }
      @keyframes pulse-card-template {
        from { opacity: 0.5; }
        to { opacity: 1; }
      }
    `);

    assert.true(
      confined.includes(
        `:where(.boxel-execution-capsule-slot) ${scoped}, :where(.boxel-execution-capsule-slot) .logo${scoped}`,
      ),
    );
    assert.true(
      confined.includes(`:where(.boxel-execution-capsule-slot) svg${scoped}`),
    );
    assert.true(confined.includes('@keyframes pulse-card-template'));
    assert.notOk(
      confined.includes(':where(.boxel-execution-capsule-slot) from'),
      'keyframe selectors are not rewritten as document selectors',
    );
  });
});

function scopedCSSRequest(
  css: string,
  fromFile = 'https://example.test/card.gts',
): string {
  return `${fromFile}.${encodeURIComponent(btoa(css))}.glimmer-scoped.css`;
}
