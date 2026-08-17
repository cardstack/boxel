// Header-free structural facts about an HTML document, computed with
// dependency-free text scans so the same reader works in the browser, the CLI,
// and the indexer. The extract persists bounded metadata only — never a second
// copy of the source; a preview fetches the document itself at view time.

export interface HtmlDocumentMetadata {
  documentTitle?: string;
  documentLanguage?: string;
  elementCount: number;
  wordCount: number;
  headingCount: number;
  linkCount: number;
  imageCount: number;
  formControlCount: number;
  scriptCount: number;
  styleSheetCount: number;
  externalResourceCount: number;
  hasDoctype: boolean;
  hasViewportMeta: boolean;
  hasInlineScript: boolean;
  hasModuleScript: boolean;
  isInteractive: boolean;
}

// An entity above the Unicode range would make `fromCodePoint` throw, and this
// decoder runs inside the index pass against hostile markup — so an invalid
// reference stays as written rather than crashing the extract.
function decodedCodePoint(raw: string, point: number): string {
  return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
    ? String.fromCodePoint(point)
    : raw;
}

// Small metadata strings need common entity decoding, not a DOM dependency.
function decodeHtmlText(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (match, code) =>
      decodedCodePoint(match, parseInt(code, 16)),
    )
    .replace(/&#(\d+);/g, (match, code) =>
      decodedCodePoint(match, Number(code)),
    );
}

// The document's readable prose with scripts, styles, and markup stripped.
function visibleText(text: string): string {
  return decodeHtmlText(
    text
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHtmlMetadata(text: string): HtmlDocumentMetadata {
  let titleMarkup = text.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '';
  let documentTitle = decodeHtmlText(
    titleMarkup
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
  let documentLanguage =
    text.match(/<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i)?.[1]?.trim() ?? '';
  let scripts = [...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  let styleBlocks = [...text.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)]
    .length;
  let linkedStyleSheets = [
    ...text.matchAll(
      /<link\b[^>]*\brel\s*=\s*["'][^"']*stylesheet[^"']*["'][^>]*>/gi,
    ),
  ].length;
  let formControlCount = [
    ...text.matchAll(/<(?:button|input|select|textarea)\b[^>]*>/gi),
  ].length;
  let inlineScripts = scripts.filter(
    (match) => !/\bsrc\s*=/.test(match[1] ?? '') && Boolean(match[2]?.trim()),
  );

  return {
    ...(documentTitle ? { documentTitle } : {}),
    ...(documentLanguage ? { documentLanguage } : {}),
    elementCount: [...text.matchAll(/<([a-z][\w:-]*)\b[^>]*>/gi)].length,
    wordCount: visibleText(text).split(/\s+/).filter(Boolean).length,
    headingCount: [...text.matchAll(/<h[1-6]\b[^>]*>/gi)].length,
    linkCount: [...text.matchAll(/<a\b[^>]*>/gi)].length,
    imageCount: [...text.matchAll(/<img\b[^>]*>/gi)].length,
    formControlCount,
    scriptCount: scripts.length,
    styleSheetCount: styleBlocks + linkedStyleSheets,
    externalResourceCount: [
      ...text.matchAll(/\b(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/gi),
    ].length,
    hasDoctype: /<!doctype\s+html\b/i.test(text),
    hasViewportMeta: /<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*>/i.test(
      text,
    ),
    hasInlineScript: inlineScripts.length > 0,
    hasModuleScript: scripts.some((match) =>
      /\btype\s*=\s*["']module["']/.test(match[1] ?? ''),
    ),
    // Authored behavior or input affordances make a document interactive; prose
    // with neither is a static page however elaborate its styling.
    isInteractive: scripts.length > 0 || formControlCount > 0,
  };
}

export function extractHtmlExcerpt(text: string, maxLength: number): string {
  let prose = visibleText(text);
  if (prose.length <= maxLength) {
    return prose;
  }
  return `${prose.slice(0, maxLength - 3).trimEnd()}...`;
}
