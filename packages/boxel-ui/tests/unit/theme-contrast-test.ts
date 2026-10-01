import {
  type RGB,
  calculateContrast,
  calculateLuminance,
  targetContrast,
} from '@cardstack/boxel-ui/helpers';
import { module, test } from 'qunit';

// Default token pairs that components paint as text on a surface. Each has to
// read under both WCAG 2 and APCA, whose verdicts diverge on mid-lightness
// hues.
const FILL_PAIRS: [fill: string, text: string][] = [
  ['success', 'success-foreground'],
  ['warning', 'warning-foreground'],
  ['info', 'info-foreground'],
  ['attention', 'attention-foreground'],
  ['destructive', 'destructive-foreground'],
  ['boxel-button-destructive-active-background', 'destructive-foreground'],
  ['popover', 'destructive-ink'],
];
const INK_HUES = [
  'primary',
  'destructive',
  'success',
  'warning',
  'info',
  'attention',
];
const INK_SURFACES = ['background', 'card', 'canvas'];
const TARGET_APCA_LC = 60;

// APCA-W3 0.1.9 lightness contrast; the sign only encodes polarity
function apcaContrast(text: RGB, background: RGB): number {
  const screenLuminance = ({ r, g, b }: RGB) => {
    const y =
      0.2126729 * (r / 255) ** 2.4 +
      0.7151522 * (g / 255) ** 2.4 +
      0.072175 * (b / 255) ** 2.4;
    return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
  };
  const txt = screenLuminance(text);
  const bg = screenLuminance(background);
  if (bg > txt) {
    const s = (bg ** 0.56 - txt ** 0.57) * 1.14;
    return s < 0.1 ? 0 : (s - 0.027) * 100;
  }
  const s = (bg ** 0.65 - txt ** 0.62) * 1.14;
  return s > -0.1 ? 0 : (s + 0.027) * 100;
}

// Painting through a canvas yields sRGB bytes whatever syntax the computed
// color serializes to (color-mix() results come back as oklch()).
function resolveColor(scope: HTMLElement, token: string): RGB {
  const probe = document.createElement('span');
  probe.style.color = `var(--${token})`;
  scope.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
  return { r, g, b };
}

module('Unit | theme contrast', function () {
  for (const scheme of ['light', 'dark']) {
    test(`default text pairs meet WCAG and APCA in the ${scheme} scheme`, function (assert) {
      const scope = document.createElement('div');
      scope.setAttribute('data-theme', scheme);
      document.body.append(scope);
      const check = (surface: string, text: string) => {
        const background = resolveColor(scope, surface);
        const foreground = resolveColor(scope, text);
        const ratio = calculateContrast(
          calculateLuminance(background),
          calculateLuminance(foreground),
        );
        const lc = Math.abs(apcaContrast(foreground, background));
        assert.true(
          ratio >= targetContrast,
          `--${text} on --${surface}: WCAG ${ratio.toFixed(2)}:1`,
        );
        assert.true(
          lc >= TARGET_APCA_LC,
          `--${text} on --${surface}: APCA Lc ${lc.toFixed(1)}`,
        );
      };
      try {
        for (const [fill, text] of FILL_PAIRS) {
          check(fill, text);
        }
        for (const hue of INK_HUES) {
          for (const surface of INK_SURFACES) {
            check(surface, `${hue}-ink`);
          }
        }
      } finally {
        scope.remove();
      }
    });
  }
});
