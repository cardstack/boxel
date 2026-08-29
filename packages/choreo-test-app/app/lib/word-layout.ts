/**
 * Where each word sits, worked out as arithmetic.
 *
 * The In-place demo's whole difficulty was that `font-size` is a LAYOUT
 * property. Every arrangement that let the browser flow the words collided
 * with it: two copies of a word sliding past each other while the arriving
 * one relaid itself out; a line whose inter-word gaps went wrong mid-flight
 * because each word was flying on its own and nothing was interpolating the
 * LINE. The gap between "14" and "March" is not a property of either word.
 *
 * pretext dissolves that. It measures text with the browser's own font
 * engine through canvas and then does layout as pure arithmetic — no DOM, no
 * reflow, no need for the text to be on screen at the size you are asking
 * about. So both poses of a line can be computed up front, at both scales,
 * and the words can be taken out of flow entirely: absolutely positioned,
 * each one's x a number the score tweens. Nothing is in layout, so nothing
 * can be disturbed by the type changing size.
 *
 * That also answers the harder question this demo stands for. A record's
 * reading view and its editor are not usually written by the same person —
 * they are separate components, and neither one can measure the other's
 * layout, because only one of them is rendered at a time. Measuring the pose
 * you are NOT showing is exactly what pretext is for.
 */
import { measureNaturalWidth, prepareWithSegments } from '@chenglou/pretext';

/** one pose of the type: what the canvas font engine needs to be asked */
export interface TypeScale {
  /** the family, as a CSS font shorthand tail — `'Archivo'` */
  family: string;
  /** px */
  size: number;
  /**
   * A `font-stretch` keyword, as the canvas font shorthand spells it.
   *
   * This is how a variable font's `wdth` axis can be BOTH measured and
   * rendered. `font-variation-settings` cannot appear in a font shorthand,
   * so a design that reaches the axis that way is a design pretext measures
   * a face wider than the one on screen — half a line of error on a long
   * name. `font-stretch` is in the shorthand, canvas honours it, and CSS
   * maps it onto the same axis.
   */
  stretch?: string;
  /** em, as CSS letter-spacing is written; converted to px for the measure */
  tracking: number;
  weight: number;
}

export interface WordBox {
  /** left edge, relative to the start of the line */
  x: number;
  width: number;
}

/** the canvas `font` shorthand for a scale */
const shorthand = (t: TypeScale) =>
  `${t.weight} ${t.stretch ? `${t.stretch} ` : ''}${t.size}px ${t.family}`;

/**
 * The words of one line, each with its left edge and width at this scale.
 *
 * `start` is the line's own inset — the form pads its fields and the reading
 * view does not, and folding that in here means the inset is tweened with
 * everything else rather than jumping at the frame the mode changes.
 */
/**
 * What the canvas says, over what the page actually draws.
 *
 * pretext measures with the canvas font shorthand, and an engine is entitled
 * to parse that shorthand differently from the way it renders CSS. Blink
 * honours `font-stretch` in the shorthand — measured, 311px becomes 280px
 * for the same string — and WebKit has historically ignored it, which means
 * the plan is computed against the WIDE cut while the screen draws the
 * narrow one. The first word lands and every word after it drifts, which is
 * exactly the "the spacing is off, but only in Safari" report.
 *
 * Rather than guess which engine honours what, the two are reconciled: one
 * sample string measured both ways, once per face, and every width scaled by
 * the ratio between them. On an engine where they already agree the ratio is
 * 1 and nothing changes. Tracking is left out of the calibration on purpose
 * — it is a per-character constant, not a property of the face, and CSS adds
 * it after the last glyph where canvas may not.
 */
const SAMPLE = 'Marguerite Villanueva 1986 @kiln.studio';
const ratios = new Map<string, number>();

let probe: HTMLElement | undefined;

function ratioFor(scale: TypeScale): number {
  const key = shorthand(scale);
  const known = ratios.get(key);
  if (known !== undefined) {
    return known;
  }
  if (typeof document === 'undefined') {
    return 1;
  }
  if (!probe) {
    probe = document.createElement('span');
    probe.setAttribute('aria-hidden', 'true');
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;white-space:pre;visibility:hidden;';
    document.body.appendChild(probe);
  }
  probe.style.fontFamily = `'${scale.family}', sans-serif`;
  probe.style.fontSize = `${scale.size}px`;
  probe.style.fontWeight = String(scale.weight);
  probe.style.fontStretch = scale.stretch ?? 'normal';
  probe.style.letterSpacing = 'normal';
  probe.textContent = SAMPLE;
  const drawn = probe.getBoundingClientRect().width;
  const measured = measureNaturalWidth(
    prepareWithSegments(SAMPLE, key, { letterSpacing: 0 })
  );
  const ratio = drawn > 0 && measured > 0 ? drawn / measured : 1;
  ratios.set(key, ratio);
  return ratio;
}

/** one string's natural width at a scale — no wrapping, no DOM */
export function measureText(text: string, scale: TypeScale): number {
  return (
    measureNaturalWidth(
      prepareWithSegments(text, shorthand(scale), {
        letterSpacing: scale.tracking * scale.size,
      })
    ) * ratioFor(scale)
  );
}

export function layoutWords(
  words: string[],
  scale: TypeScale,
  start = 0
): WordBox[] {
  const font = shorthand(scale);
  const letterSpacing = scale.tracking * scale.size;
  const ratio = ratioFor(scale);
  const measure = (text: string) =>
    text
      ? measureNaturalWidth(
          prepareWithSegments(text, font, { letterSpacing })
        ) * ratio
      : 0;

  // Each word's left edge is the WHOLE line's width less the width of the
  // line from that word on. Nothing here invents an inter-word gap, and that
  // is the point: the first version added a flat 0.3em between words, which
  // put the first word on the pixel and every word after it a few out —
  // visible as the space between a first and last name changing on handover.
  // A space's advance is the font's business, it varies with the face and
  // with letter-spacing, and it is already inside these measurements.
  const line = measure(words.join(' '));
  const out: WordBox[] = [];
  for (let index = 0; index < words.length; index++) {
    const suffix = measure(words.slice(index).join(' '));
    out.push({ width: measure(words[index]!), x: start + line - suffix });
  }
  return out;
}

/**
 * Resolve the fonts a scale needs before anything is measured.
 *
 * Canvas measurement is only as good as the face the browser has: ask before
 * Archivo has loaded and every width comes back in the fallback's metrics,
 * which is a whole line's worth of error that never corrects itself. The
 * demo measures once this resolves, and again if a face arrives later.
 */
export async function typeReady(scales: TypeScale[]): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) {
    return;
  }
  await Promise.all(scales.map((scale) => fonts.load(shorthand(scale))));
  await fonts.ready;
  // warm the canvas-against-page calibration while nothing is in flight: it
  // reads the DOM once per face, and that is not a thing to do mid-pass
  for (const scale of scales) {
    ratioFor(scale);
  }
}
