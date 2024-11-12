import {
  calculateContrast,
  calculateLuminance,
  hslToRgb,
  rgbToHex,
  targetContrast,
} from './color-tools.ts';

// Selects a random color from a set of colors based on the input string
export function deterministicColorFromString(str: string): string {
  if (!str) {
    return 'transparent';
  }

  // Generate hash value between 0-1
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  hash = Math.abs(hash);

  const hue = hash % 360;
  const saturation = 65 + (hash % 15); // 65-80% for better contrast

  let lightness = 50; // Starting lightness value
  let rgb = hslToRgb(hue, saturation, lightness);

  // Adjust lightness to ensure target contrast ratio or above
  while (lightness <= 100) {
    const luminance = calculateLuminance(rgb);
    const contrastWithBlack = calculateContrast(luminance, 0); // Black luminance = 0
    const contrastWithWhite = calculateContrast(luminance, 1); // White luminance = 1
    // Check if the color meets contrast requirements against black or white
    if (
      contrastWithBlack >= targetContrast ||
      contrastWithWhite >= targetContrast
    ) {
      break;
    }
    lightness++;
    rgb = hslToRgb(hue, saturation, lightness);
  }

  return rgbToHex(rgb);
}
