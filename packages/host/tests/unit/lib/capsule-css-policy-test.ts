import { module, test } from 'qunit';

import {
  confineCapsuleStylesheet,
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

function scopedCSSRequest(css: string): string {
  return `https://example.test/card.gts.${encodeURIComponent(btoa(css))}.glimmer-scoped.css`;
}
