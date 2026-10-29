import type {
  CardResource,
  FileMetaResource,
  Relationship,
  Saved,
} from '@cardstack/runtime-common';

// Stories on the shelf: few enough that the catalog stays a shelf beside the
// workspaces rather than the page's main event.
export const STORY_COUNT = 4;

// Each story wears its own paper, in turn: warm, ink, mint, lilac.
export const STORY_TINTS = ['warm', 'ink', 'mint', 'lilac'] as const;
export type StoryTint = (typeof STORY_TINTS)[number];

// What the shelf reads of a listing, as `item.<field>` entries of a sparse
// fieldset, so the search answers from the index and no card code loads.
export const LISTING_FIELDS = [
  'item.name',
  'item.summary',
  'item.cardThumbnailURL',
  'item.examples',
];

// A search result's identity and its field-limited serialization.
export interface ListingEntry {
  id: string;
  item?: CardResource<Saved> | FileMetaResource;
}

export interface Story {
  // The listing's URL, which Remix / Use and the story itself open.
  id: string;
  eyebrow: string;
  name: string;
  copy: string;
  action: 'Remix' | 'Use';
  // The listing's thumbnail, which stands in for the example's art.
  thumbnailURL: string | undefined;
  // The listing's first example, which Try it opens and the art shows.
  exampleId: string | undefined;
  tint: StoryTint;
  // The ink paper is dark; the rest are light.
  scheme: 'light' | 'dark';
}

// Turns a link as a relationship carries it into a card URL: `data.id` when
// the index resolved it, otherwise `links.self`, which a relative link
// resolves against the card that holds it.
export type ResolveLink = (link: string, base: string) => string;

// The URLs a linksToMany field links to, in order. Plural fields serialize as
// `field.0`, `field.1`, ….
export function linkedIds(
  entry: ListingEntry,
  field: string,
  resolve: ResolveLink,
): string[] {
  let relationships = (entry.item?.relationships ?? {}) as Record<
    string,
    Relationship | Relationship[]
  >;
  let prefix = `${field}.`;
  return Object.keys(relationships)
    .filter((key) => key.startsWith(prefix))
    .map((key) => ({ key, index: Number(key.slice(prefix.length)) }))
    .filter(({ index }) => Number.isInteger(index))
    .sort((a, b) => a.index - b.index)
    .map(({ key }) => {
      let relationship = relationships[key];
      if (Array.isArray(relationship)) {
        return undefined;
      }
      let data = relationship?.data;
      if (data && !Array.isArray(data) && 'id' in data && data.id) {
        return resolve(data.id, entry.id);
      }
      let self = relationship?.links?.self;
      return typeof self === 'string' ? resolve(self, entry.id) : undefined;
    })
    .filter((id): id is string => Boolean(id));
}

// Search reports a listing's base type, but an instance lives in a folder
// named for its own class ("…/CardListing/<id>"), which says what the
// listing offers ("Card").
const LISTING_FOLDER = /^([A-Za-z]+)Listing$/;

export function kindOf(listingId: string): string {
  let folder = listingId.split('/').slice(-2, -1)[0] ?? '';
  return LISTING_FOLDER.exec(folder)?.[1] ?? 'Listing';
}

// The label over a story: the lead is the catalog's pick of the week, the
// rest say what you'd get.
export function eyebrowOf(kind: string, isLead: boolean): string {
  if (isLead) {
    return `${kind} of the week`;
  }
  switch (kind) {
    case 'App':
      return 'New app';
    case 'Theme':
      return 'New theme';
    case 'Skill':
      return 'New skill';
    case 'Field':
      return 'Build with it';
    case 'Card':
      return 'New card';
    default:
      return 'New in the catalog';
  }
}

// Listing names are written for the catalog's own index ("Wine Cellar Card
// Definition"); on the shelf the kind already rides in the eyebrow.
const DEFINITION_SUFFIX = /\s+(?:(?:card|field|app)\s+)?definition$/i;

export function shelfName(name: string | undefined): string {
  return name ? name.replace(DEFINITION_SUFFIX, '') : 'Untitled listing';
}

// A summary that opens by describing the code ("The WineCellar component
// serves as…") is documentation, not a pitch, so such a listing gets a line
// that says what its kind is for.
const CODE_DESCRIPTION = /^the\s+\S+\s+(?:component|card|field)\b/i;

const KIND_COPY: Record<string, string> = {
  App: 'A whole app made of cards. Remix it into a workspace and change anything.',
  Theme: 'A look for your cards. Use it on any workspace.',
  Skill: 'Teach Boxel AI something new, then use it in any chat.',
  Field: 'A field to build your own cards with.',
};

const DEFAULT_COPY =
  'Ready-made and free to remix: make it yours in a workspace of your own.';

export function shelfCopy(kind: string, summary: string | undefined): string {
  if (summary && !CODE_DESCRIPTION.test(summary)) {
    return summary;
  }
  return KIND_COPY[kind] ?? DEFAULT_COPY;
}

// Themes and skills are used as they are; cards, fields and apps are
// remixed into a workspace of your own. Either way the listing runs it.
export function actionOf(kind: string): Story['action'] {
  return kind === 'Theme' || kind === 'Skill' ? 'Use' : 'Remix';
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

// The shelf's stories: the featured listings in the catalog's order, then
// other listings. A listing without a thumbnail has nothing to show while
// its example loads, so it stays off the shelf.
export function storiesFrom({
  featuredIds,
  featured,
  others,
  resolve,
}: {
  featuredIds: string[];
  featured: ListingEntry[];
  others: ListingEntry[];
  resolve: ResolveLink;
}): Story[] {
  let order = new Map(featuredIds.map((id, index) => [id, index]));
  let byOrder = (a: ListingEntry, b: ListingEntry) =>
    (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity);
  let leading = featured.filter((entry) => order.has(entry.id)).sort(byOrder);
  let seen = new Set(leading.map((entry) => entry.id));
  return [...leading, ...others.filter((entry) => !seen.has(entry.id))]
    .filter((entry) => text(entry.item?.attributes?.cardThumbnailURL))
    .slice(0, STORY_COUNT)
    .map((entry, index): Story => {
      let kind = kindOf(entry.id);
      let tint = STORY_TINTS[index % STORY_TINTS.length]!;
      let attributes = entry.item?.attributes ?? {};
      return {
        id: entry.id,
        eyebrow: eyebrowOf(kind, index === 0),
        name: shelfName(text(attributes.name)),
        copy: shelfCopy(kind, text(attributes.summary)),
        action: actionOf(kind),
        thumbnailURL: text(attributes.cardThumbnailURL),
        exampleId: linkedIds(entry, 'examples', resolve)[0],
        tint,
        scheme: tint === 'ink' ? 'dark' : 'light',
      };
    });
}
