import { module, test } from 'qunit';

// The order statement in src/styles/global.css does not survive bundling —
// component <style> blocks are extracted ahead of it and esbuild then prunes
// the names it has already seen, so each app entry repeats the statement in an
// inline <style> at the top of <head>. These tests assert against the order the
// running document actually resolved, which is the thing that matters.
const LAYERS = [
  'vendor',
  'reset',
  'utilities',
  'boxelComponentL1',
  'boxelComponentL2',
  'boxelComponentL3',
  'boxelComponentL4',
];

// Declares one rule per layer, all of equal specificity, in an order that is
// the reverse of the expected cascade order — so source order and the layer
// order disagree and only the layers can decide the winner.
function probeCSS(className: string): string {
  return [...LAYERS]
    .reverse()
    .map(
      (layer, i) =>
        `@layer ${layer} { .${className} { --probe: ${LAYERS.length - 1 - i}; } }`,
    )
    .join('\n');
}

function withProbe(className: string, css: string, fn: () => void): void {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);
  const el = document.createElement('div');
  el.className = className;
  document.body.append(el);
  try {
    fn();
  } finally {
    style.remove();
    el.remove();
  }
}

module('Unit | css layer order', function () {
  test('the highest declared layer wins regardless of source order', function (assert) {
    withProbe('boxel-layer-probe', probeCSS('boxel-layer-probe'), () => {
      const el = document.querySelector('.boxel-layer-probe')!;
      assert.strictEqual(
        getComputedStyle(el).getPropertyValue('--probe').trim(),
        String(LAYERS.length - 1),
        `${LAYERS[LAYERS.length - 1]} outranks every layer below it`,
      );
    });
  });

  test('every boxel-ui layer outranks vendor', function (assert) {
    for (const layer of LAYERS.slice(1)) {
      const css = `@layer ${layer} { .boxel-layer-probe { --probe: component; } }
@layer vendor { .boxel-layer-probe { --probe: vendor; } }`;
      withProbe('boxel-layer-probe', css, () => {
        const el = document.querySelector('.boxel-layer-probe')!;
        assert.strictEqual(
          getComputedStyle(el).getPropertyValue('--probe').trim(),
          'component',
          `${layer} outranks vendor`,
        );
      });
    }
  });

  test('unlayered author styles outrank every layer', function (assert) {
    const css = `@layer boxelComponentL4 { .boxel-layer-probe { --probe: layered; } }
.boxel-layer-probe { --probe: unlayered; }`;
    withProbe('boxel-layer-probe', css, () => {
      const el = document.querySelector('.boxel-layer-probe')!;
      assert.strictEqual(
        getComputedStyle(el).getPropertyValue('--probe').trim(),
        'unlayered',
        'a consuming app can override boxel-ui without fighting specificity',
      );
    });
  });
});
