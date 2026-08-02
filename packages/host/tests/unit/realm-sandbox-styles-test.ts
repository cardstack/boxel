import { getService } from '@universal-ember/test-support';
import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import {
  validateCompartmentCSS,
  validateCompartmentInlineStyle,
} from '@cardstack/host/services/realm-sandbox';

module('Unit | Service | realm sandbox styles', function (hooks) {
  setupTest(hooks);

  test('shares identical scoped styles until the last card releases them', function (assert) {
    let service = getService('realm-sandbox-styles');
    let css = '[data-scope="example"] { color: rebeccapurple; }';

    let releaseFirst = service.acquire([css, css]);
    let releaseSecond = service.acquire([css]);
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      1,
      'one document stylesheet serves every matching card',
    );

    releaseFirst();
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      1,
      'the stylesheet remains while another card consumes it',
    );

    releaseSecond();
    assert.strictEqual(
      document.querySelectorAll('[data-realm-sandbox-stylesheet]').length,
      0,
      'the last release removes the stylesheet',
    );
  });

  test('uses parsed CSS to reject network-bearing values', function (assert) {
    let safe = '[data-scope="example"] { color: rebeccapurple; }';
    assert.strictEqual(validateCompartmentCSS(safe), safe);

    for (let css of [
      '@import "https://evil.example/steal.css";',
      '.card { background: url("https://evil.example/steal"); }',
      '.card { background-image: image-set("https://evil.example/steal" 1x); }',
      '.card { background-image: -webkit-image-set("steal.png" 1x); }',
      '.card { background: u\\72l("https://evil.example/steal"); }',
      '@\\69 mport "https://evil.example/steal.css";',
      '.card { background: \\75 rl("https://evil.example/steal"); }',
      '.card { background-image: image\\2d set("steal.png" 1x); }',
    ]) {
      assert.throws(
        () => validateCompartmentCSS(css),
        /network-bearing value/,
        css,
      );
    }
  });

  test('validates literal inline styles before they reach the DOM', function (assert) {
    let safe = 'width: 100%; color: rebeccapurple';
    assert.strictEqual(validateCompartmentInlineStyle(safe), safe);

    for (let style of [
      'background: url("https://evil.example/steal")',
      'background: u\\72l("https://evil.example/steal")',
      'background-image: image-set("steal.png" 1x)',
    ]) {
      assert.throws(
        () => validateCompartmentInlineStyle(style),
        /network-bearing value/,
        style,
      );
    }
  });

  test('requires every shared-document selector to retain its compiled scope', function (assert) {
    let scoped = '[data-scopedcss-card-template]';
    let safe = `
      ${scoped}, article${scoped}:is(.featured, .selected) { color: rebeccapurple; }
      @media (min-width: 40rem) {
        .summary${scoped} { display: grid; }
      }
      @keyframes pulse-card-template {
        from { opacity: 0.5; }
        to { opacity: 1; }
      }
    `;
    assert.strictEqual(
      validateCompartmentCSS(safe, { requireScopedSelectors: true }),
      safe,
      'scoped selector lists, nested rules, and compiled keyframes remain available',
    );

    for (let css of [
      `body { color: transparent; }`,
      `${scoped}, body { color: transparent; }`,
      `@media (min-width: 1px) { body { color: transparent; } }`,
      `${scoped} ~ * { visibility: hidden; }`,
      `${scoped} body { visibility: hidden; }`,
      `body:has(${scoped}) { visibility: hidden; }`,
    ]) {
      assert.throws(
        () => validateCompartmentCSS(css, { requireScopedSelectors: true }),
        /selector escaped its compiled scope/,
        css,
      );
    }
  });

  test('rejects document-global registrations from compartment styles', function (assert) {
    let scoped = '[data-scopedcss-card-template]';
    for (let css of [
      '@font-face { font-family: stolen; src: local(Arial); }',
      '@property --host-color { syntax: "<color>"; inherits: true; initial-value: red; }',
      '@counter-style host-counter { system: cyclic; symbols: x; }',
      '@font-feature-values HostFont { @styleset { compact: 1; } }',
      '@font-palette-values --host-palette { font-family: serif; }',
      '@color-profile --host-profile { src: local; }',
      '@page { margin: 0; }',
      '@viewport { width: 1px; }',
      '@scroll-timeline host-scroll { source: auto; }',
      '@layer host-reset { body { color: transparent; } }',
      '@layer host-reset, card;',
      '@font\\-face { font-family: stolen; src: local(Arial); }',
      '@lay\\65 r host-reset { body { color: transparent; } }',
    ]) {
      assert.throws(
        () => validateCompartmentCSS(css, { requireScopedSelectors: true }),
        /document-global rule/,
        css,
      );
    }

    let anonymousLayer = `@layer { .card${scoped} { color: teal; } }`;
    assert.strictEqual(
      validateCompartmentCSS(anonymousLayer, {
        requireScopedSelectors: true,
      }),
      anonymousLayer,
      'an anonymous layer containing only scoped rules has no reusable global name',
    );
  });
});
