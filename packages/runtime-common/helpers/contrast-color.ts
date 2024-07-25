// Takes in a hex color and returns the color (black or white) that should be used for text on top of it.
// https://stackoverflow.com/a/35970186
export function getContrastColor(hex?: string) {
  if (!hex) {
    return;
  }
  if (hex.indexOf('#') === 0) {
    hex = hex.slice(1);
  }
  // convert 3-digit hex to 6-digits.
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  if (hex.length !== 6) {
    console.error('Expecting hex color with 6 digits.');
    return;
  }
  let r = parseInt(hex.slice(0, 2), 16);
  let g = parseInt(hex.slice(2, 4), 16);
  let b = parseInt(hex.slice(4, 6), 16);

  return r * 0.299 + g * 0.587 + b * 0.114 > 186
    ? 'var(--boxel-dark, #000000)'
    : 'var(--boxel-light, #ffffff)';
}
