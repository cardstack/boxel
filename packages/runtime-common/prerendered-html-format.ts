export const PRERENDERED_HTML_FORMATS = [
  'embedded',
  'fitted',
  'atom',
  'head',
] as const;

export type PrerenderedHtmlFormat = (typeof PRERENDERED_HTML_FORMATS)[number];

export function isValidPrerenderedHtmlFormat(
  format: string | undefined,
): format is PrerenderedHtmlFormat {
  return (
    format !== undefined &&
    PRERENDERED_HTML_FORMATS.includes(format as PrerenderedHtmlFormat)
  );
}
