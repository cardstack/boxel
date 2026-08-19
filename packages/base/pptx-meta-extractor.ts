// Reads a PowerPoint deck (`.pptx`) for its identity, its slide count, and a
// bounded outline. Each slide is its own part (`ppt/slides/slideN.xml`); within
// it, a shape's `<p:ph>` placeholder type says whether the shape is the slide's
// title, and each `<a:p>` paragraph is one line of text. The preview is that
// outline — slide titles and their bullet lines — which is what a deck's
// embedded and isolated previews render as a grid of slide cards.

import {
  OoxmlPackage,
  decodeXmlEntities,
  pruneUndefined,
  readCoreProperties,
  type DeckPreview,
  type DeckSlide,
  type OfficeMetadata,
} from './ooxml';

// A deck's opening slides carry its shape; the rest repeat the pattern. Bounds
// keep the stored outline small for a hundred-slide deck.
const MAX_SLIDES = 30;
const MAX_BULLETS = 12;
const MAX_LINE_CHARS = 200;

// The text of one `<a:p>` paragraph: its `<a:t>` runs joined, whitespace
// collapsed.
function paragraphLines(shapeXml: string): string[] {
  let paragraphs = [
    ...shapeXml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g),
  ];
  let lines: string[] = [];
  for (let p of paragraphs) {
    let runs = [...p[1]!.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)];
    let text = runs
      .map((m) => decodeXmlEntities(m[1]!))
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      lines.push(
        text.length > MAX_LINE_CHARS ? text.slice(0, MAX_LINE_CHARS) : text,
      );
    }
  }
  return lines;
}

function isTitlePlaceholder(shapeXml: string): boolean {
  // A title shape declares `<p:ph type="title"/>` or `type="ctrTitle"`; a body
  // placeholder has another type or none.
  let ph = shapeXml.match(/<p:ph\b[^>]*\btype="([^"]*)"/);
  let type = ph?.[1] ?? '';
  return type === 'title' || type === 'ctrTitle';
}

function readSlide(slideXml: string, index: number): DeckSlide {
  let shapes = [
    ...slideXml.matchAll(/<p:sp(?:\s[^>]*)?>([\s\S]*?)<\/p:sp>/g),
  ].map((m) => m[1]!);
  let title: string | undefined;
  let bullets: string[] = [];
  for (let shape of shapes) {
    let lines = paragraphLines(shape);
    if (!lines.length) {
      continue;
    }
    if (title === undefined && isTitlePlaceholder(shape)) {
      title = lines.join(' ');
      continue;
    }
    for (let line of lines) {
      if (bullets.length < MAX_BULLETS) {
        bullets.push(line);
      }
    }
  }
  // A slide with no marked title placeholder still deserves a heading; the
  // first bullet reads as one and is lifted out of the body.
  if (title === undefined && bullets.length) {
    title = bullets.shift();
  }
  return { index, ...(title ? { title } : {}), bullets };
}

// The slide parts in presentation order. Sorting by the numeric suffix matches
// the usual authoring order without resolving `presentation.xml`'s relationship
// ids — good enough for a bounded outline.
function slidePartsInOrder(pkg: OoxmlPackage): string[] {
  return pkg
    .names()
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      let na = Number(a.match(/slide(\d+)\.xml$/)![1]);
      let nb = Number(b.match(/slide(\d+)\.xml$/)![1]);
      return na - nb;
    });
}

// Read a `.pptx`'s facts and a bounded outline. Throws
// `FileContentMismatchError` (via `OoxmlPackage.open`) when the bytes aren't an
// OOXML package. A deck whose slide text won't read still returns its slide
// count from the properties.
export async function extractPptxMetadata(
  bytes: Uint8Array,
): Promise<OfficeMetadata> {
  let pkg = await OoxmlPackage.open(bytes);
  let core = await readCoreProperties(pkg);
  let slideParts = slidePartsInOrder(pkg);
  // The part count is the authoritative slide count; the extended-property
  // `Slides` is a fallback for a deck whose parts we somehow can't enumerate.
  let slideCount = slideParts.length || core.slideCount;

  let slides: DeckSlide[] = [];
  let truncated = false;
  for (let i = 0; i < slideParts.length; i++) {
    if (slides.length >= MAX_SLIDES) {
      truncated = true;
      break;
    }
    let xml = await pkg.readText(slideParts[i]!);
    if (xml) {
      slides.push(readSlide(xml, i + 1));
    }
  }
  let preview: DeckPreview = { slides, truncated };

  return pruneUndefined({
    ...core,
    kind: 'presentation',
    slideCount,
    previewJson: slides.length > 0 ? JSON.stringify(preview) : undefined,
  }) as OfficeMetadata;
}
