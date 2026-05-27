import {
  calculateContrast,
  calculateLuminance,
  hexToRgb,
  targetContrast,
  targetContrastAAA,
} from './color-tools.ts';

/*
  Takes in a hex color code and returns black or white depending on the contrast ratio.
  Useful for situations where you need to display text on top of a dynamic background-color.
  Example: '#ffeb00' returns '#000000' (black); '#1a4f76' returns '#ffffff' (white)
  Inspired by https://stackoverflow.com/a/35970186
  More info: https://www.w3.org/TR/WCAG20-TECHS/G18.html
*/
export function getContrastColor(
  value: string | undefined,
  darkColor = 'var(--boxel-dark, #000000)',
  lightColor = 'var(--boxel-light, #ffffff)',
  opts?: { isSmallText: true },
) {
  if (!value) {
    return;
  }
  let rgb = hexToRgb(value);
  if (!rgb) {
    return;
  }
  let ratio = calculateContrast(calculateLuminance(rgb), 0); // luminocity of black is 0
  let contrastLevel = opts?.isSmallText ? targetContrastAAA : targetContrast;
  return ratio >= contrastLevel ? darkColor : lightColor;
}
