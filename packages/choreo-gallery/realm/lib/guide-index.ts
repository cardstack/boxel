/**
 * The context a guide's page provides to everything rendered inside it, its
 * embedded demos included: the slug of the guide being read.
 */
export const CurrentGuideContext = 'choreo-gallery:current-guide';

/** a guide the index lists: its slug (`core-start`) and its title */
export interface GuideEntry {
  slug: string;
  title: string;
}

/** a section of the guides' index, with its guides in reading order */
export interface GuideSection {
  guides: GuideEntry[];
  /** the section's number, `01` */
  number: string;
  title: string;
}

const SECTION = /^## (?:(\d+)\s+)?(.+?)\s*$/;
const ENTRY = /^- \[([^\]]+)\]\(([\w-]+)\)/;

/**
 * The sections of the guides' index, `docs/guides/README.md`, read from its
 * Markdown: each `## 01 Section` heading opens a section, and each
 * `- [Title](slug)` item under it lists a guide. Prose between them is the
 * index's own, and is not navigation.
 */
export function guideSections(markdown: string): GuideSection[] {
  let sections: GuideSection[] = [];
  for (let line of markdown.split(/\r?\n/)) {
    let heading = SECTION.exec(line);
    if (heading) {
      sections.push({
        number: heading[1] ?? '',
        title: heading[2]!,
        guides: [],
      });
      continue;
    }
    let entry = ENTRY.exec(line);
    if (entry && sections.length) {
      sections.at(-1)!.guides.push({ title: entry[1]!, slug: entry[2]! });
    }
  }
  return sections.filter((section) => section.guides.length);
}

/** the slug a guide card's URL ends in: `docs/guides/core-start` is `core-start` */
export function guideSlug(id: string | undefined): string | undefined {
  return id?.replace(/\/+$/, '').split('/').pop() || undefined;
}
