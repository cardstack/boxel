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
) {
  if (!value) {
    return;
  }
  let hex = value.replace(/^#/, '');
  // convert 3-digit code to 6-digit hex code
  if (hex.length === 3) {
    hex = hex.replace(
      /([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])/,
      '$1$1$2$2$3$3',
    );
  }
  if (hex.length !== 6) {
    console.error(`Error: "${value}" is not a valid hex color code.`);
    return;
  }

  // convert hex to rgb values
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);

  // The following calculations are based on https://www.w3.org/TR/WCAG20-TECHS/G18.html
  // divide by 255 to get each color's value between 0 and 1
  let colors = [r / 255, g / 255, b / 255];

  // apply gamma correction
  [r, g, b] = colors.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];

  // formula for relative luminance: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
  let lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

  // formula for contrast ratio: (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter color
  let ratio = (lum + 0.05) / 0.05; // luminocity of black is 0

  // contrast ratio should be at least 4.5 for regular sized text based on WCAG guidelines
  return ratio >= 4.5 ? darkColor : lightColor;
}
