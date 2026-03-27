import { FileContentMismatchError } from './file-api';

/**
 * Extract width and height from an SVG file's bytes.
 *
 * Looks for explicit `width`/`height` attributes on the root `<svg>` element
 * first, then falls back to the `viewBox` attribute. Only absolute numeric
 * values (with optional "px" suffix) are accepted for width/height attributes;
 * percentage or other relative units are ignored in favour of viewBox.
 */
export function extractSvgDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new FileContentMismatchError(
      'File cannot be decoded as UTF-8 text',
    );
  }

  // Find the opening <svg ...> tag (case-insensitive, may span multiple lines)
  let svgTagMatch = text.match(/<svg\b[^>]*>/is);
  if (!svgTagMatch) {
    throw new FileContentMismatchError(
      'File does not contain an SVG root element',
    );
  }
  let svgTag = svgTagMatch[0];

  // Try explicit width/height attributes first (numeric values, optional "px")
  let widthAttr = svgTag.match(/\bwidth\s*=\s*["']?\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']?/i);
  let heightAttr = svgTag.match(/\bheight\s*=\s*["']?\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*["']?/i);

  if (widthAttr && heightAttr) {
    return {
      width: Math.round(parseFloat(widthAttr[1]!)),
      height: Math.round(parseFloat(heightAttr[1]!)),
    };
  }

  // Fall back to viewBox="minX minY width height"
  let viewBoxAttr = svgTag.match(
    /\bviewBox\s*=\s*["']\s*[\d.]+[\s,]+[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i,
  );
  if (viewBoxAttr) {
    return {
      width: Math.round(parseFloat(viewBoxAttr[1]!)),
      height: Math.round(parseFloat(viewBoxAttr[2]!)),
    };
  }

  throw new FileContentMismatchError(
    'SVG does not specify width/height or viewBox dimensions',
  );
}
