// Reads a Word document (`.docx`) for its identity, its length, and a bounded
// sample of its text flow. The counts come from the shared extended properties;
// the flow is read from `word/document.xml`, whose `<w:p>` paragraphs carry
// `<w:t>` text runs and, on a heading, a `<w:pStyle>` that names the level. The
// preview surfaces real prose — a document's opening paragraphs and headings —
// rather than a generic page mock, and stays bounded so a book-length file's
// body never becomes the stored preview.

import {
  OoxmlPackage,
  decodeXmlEntities,
  pruneUndefined,
  readCoreProperties,
  type DocumentPreview,
  type OfficeMetadata,
  type OfficeTextBlock,
} from './ooxml';

// A document's opening is what a preview shows; the rest is scrolled to in the
// real file. Bounds keep the stored preview small.
const MAX_BLOCKS = 60;
const MAX_BLOCK_CHARS = 600;

function paragraphText(paragraph: string): string {
  // A run's text sits in `<w:t>`; tabs and line breaks are their own empty
  // elements. Join runs directly (Word already splits a word across runs for
  // formatting) and turn structural breaks into whitespace.
  let withBreaks = paragraph
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n');
  let runs = [...withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)];
  let text = runs.map((m) => decodeXmlEntities(m[1]!)).join('');
  return text.replace(/[ \t]+/g, ' ').trim();
}

function blockStyle(paragraph: string): {
  style: OfficeTextBlock['style'];
  level?: number;
} {
  let styleMatch = paragraph.match(/<w:pStyle\s+w:val="([^"]*)"/);
  let name = styleMatch?.[1] ?? '';
  if (/^title$/i.test(name)) {
    return { style: 'title' };
  }
  // "Heading1", "Heading 1", "Heading2" … — the trailing digit is the depth.
  let heading = name.match(/^heading\s*(\d+)/i);
  if (heading) {
    return { style: 'heading', level: Number(heading[1]) };
  }
  return { style: 'body' };
}

function readDocumentPreview(documentXml: string): DocumentPreview {
  let paragraphs = [
    ...documentXml.matchAll(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/g),
  ];
  let blocks: OfficeTextBlock[] = [];
  let truncated = false;
  for (let match of paragraphs) {
    let body = match[1]!;
    let text = paragraphText(body);
    if (!text) {
      continue;
    }
    if (blocks.length >= MAX_BLOCKS) {
      truncated = true;
      break;
    }
    let { style, level } = blockStyle(body);
    blocks.push({
      style,
      ...(level ? { level } : {}),
      text:
        text.length > MAX_BLOCK_CHARS ? text.slice(0, MAX_BLOCK_CHARS) : text,
    });
  }
  return { blocks, truncated };
}

// Read a `.docx`'s facts and a bounded sample of its text flow. Throws
// `FileContentMismatchError` (via `OoxmlPackage.open`) when the bytes aren't an
// OOXML package, so the extract falls back to a plain FileDef. A package with no
// readable body still returns its properties.
export async function extractDocxMetadata(
  bytes: Uint8Array,
): Promise<OfficeMetadata> {
  let pkg = await OoxmlPackage.open(bytes);
  let core = await readCoreProperties(pkg);
  let documentXml = await pkg.readText('word/document.xml');
  let preview = documentXml ? readDocumentPreview(documentXml) : undefined;

  return pruneUndefined({
    ...core,
    kind: 'word',
    previewJson:
      preview && preview.blocks.length > 0
        ? JSON.stringify(preview)
        : undefined,
  }) as OfficeMetadata;
}
