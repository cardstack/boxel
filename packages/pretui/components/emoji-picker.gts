// Pretui — EmojiPicker: a searchable, keyboard-navigable emoji grid.
//
// A searchable, keyboard-complete emoji picker and the small trigger that
// opens one in a popover.
//
// PROVENANCE. The interaction design, the search ranking, the skin-tone
// handling and the emoji-support detection are ported from Nolan Lawson's
// emoji-picker-element (Apache-2.0). The dataset and the ported algorithms
// live in ./emoji-data/ with the licence and the full provenance record; that
// directory's README explains why this is a PORT rather than a vendored
// bundle. The short version, because it is the load-bearing fact: the
// upstream bundle references `requestAnimationFrame`, `Element`,
// `HTMLElement` and `customElements` at MODULE SCOPE and ships no server-safe
// globals shim, so importing it anywhere in the realm graph throws under the
// indexer. Media Chrome survived vendoring because it has that shim; this
// library does not.
//
// WHAT UPSTREAM GOT WRONG, AND WHAT IS FIXED HERE (specifically):
//
//  1. THE BROWSE GRID HAS NO KEYBOARD PATH. Upstream renders every emoji in a
//     category as a bare <button> with no tabindex management, so a category
//     is 388 consecutive tab stops and there is no arrow-key navigation at
//     all — the only keydown handlers are on the search field, the category
//     nav and the skin-tone list. Here the grid is one tab stop with roving
//     tabindex and full 2-D arrow / Home / End / PageUp / PageDown movement.
//  2. THE GRID USES THE WRONG ROLE. Upstream marks it up as role='menu' with
//     role='menuitem' children, which is a single-column action list; a
//     screen reader announces "menu, 388 items" and no position. This is a
//     role='grid' of role='row' / role='gridcell', so row and column position
//     are announced and the APG grid pattern applies.
//  3. IT FETCHES ITS DATA FROM A CDN AT RUNTIME. jsdelivr, with ETag
//     revalidation, into IndexedDB. That breaks offline, pins us to a third
//     party's uptime and is the same supply-chain exposure being removed from
//     the QR component. The dataset is local and the picker never touches the
//     network.
//  4. IT FORKS ON prefers-color-scheme INSIDE ITS OWN SHADOW ROOT. A picker
//     in a Pretui dark theme frame on a light OS came out light. Every colour
//     here is a token with a light-value fallback and there are zero dark
//     branches, so the theme frame decides.
//  5. NO EMOJI PREVIEW. Upstream puts the CLDR name in a `title` tooltip,
//     which is hover-only and invisible in a screenshot. A persistent preview
//     row names the focused emoji in text — the Law 8 resting state.
//
// KNOWN UNFINISHED EDGE, named rather than hidden (Law 7). Upstream also runs
// a per-emoji glyph WIDTH measurement to catch ZWJ sequences the font renders
// as two glyphs ("person with red hair" drawn as a person plus a floating
// wig). Versions 12.1, 13.1 and 15.1 are compound-only and can be caught no
// other way. That check is a layout-thrashing measure pass over every
// rendered cell; the cheap half — canvas colour detection of the font's
// version level — IS ported and removes the bulk of the tofu. See
// ./emoji-data/README.md.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { listen } from '../focus';
import { cssStyleFrom } from '../pretui-css';
import { EMOJI_GROUPS, EmojiIndex, MIN_SEARCH_LENGTH, SKIN_TONE_LABELS, SKIN_TONE_SAMPLE, applySkinTone, detectSupportLevel, toneOf } from '../emoji-data/engine';
import type { Emoji } from '../emoji-data/engine';

// ── Public shapes ────────────────────────────────────────────────────────

/** What a caller receives when someone picks an emoji. */
export interface EmojiSelection {
  /** The emoji to insert, with the active skin tone already applied. */
  unicode: string;
  /** The CLDR annotation, e.g. "waving hand". Safe to use as alt text. */
  annotation: string;
  /** The untoned emoji, which is the identity used by the recent list. */
  base: string;
  /** The tone that was applied, 0 when none. */
  skinTone: number;
}

/** The id the recent pseudo-category uses; no emojibase group has it. */
const RECENT_GROUP = -1;

const DEFAULT_COLUMNS = 9;
const DEFAULT_RECENT_LIMIT = 18;
/** Rows moved by PageUp / PageDown. */
const PAGE_ROWS = 5;
/** How long the query must be still before the result count is announced. */
const ANNOUNCE_DELAY = 700;

let uid = 0;
/** Deterministic per-instance id source. A counter, not Math.random, because
 * randomness breaks indexing determinism. */
function nextId(): string {
  uid += 1;
  return 'pretui-emoji-' + uid;
}

// ── Modifiers ────────────────────────────────────────────────────────────

/**
 * Build the index once the picker is in a real browser.
 *
 * This is the ONLY place the dataset is requested, and it is deliberately a
 * modifier: `detectSupportLevel` needs a canvas and `import('./data')` should
 * not run under the indexer. A getter would be evaluated during prerender and
 * is exactly the mistake the Observable Plot spike warned about.
 */
const buildIndex = modifier(
  (_el: HTMLElement, [run]: [(cancelled: () => boolean) => void]) => {
    let destroyed = false;
    run(() => destroyed);
    return () => {
      destroyed = true;
    };
  },
);

/**
 * Roving tabindex and focus for the grid, applied imperatively in one pass.
 *
 * Doing this with a per-cell modifier would re-run 388 modifiers on every
 * arrow key. This runs twice per keystroke: one loop to set tabIndex, one
 * `focus()`. `key` is the change key — the identity of the current cell list —
 * so switching category or typing re-seats the roving stop.
 *
 * tabIndex is set as a PROPERTY, matching `rovingTabindex` in focus.gts.
 */
const rovingGrid = modifier(
  (
    el: HTMLElement,
    [index, shouldFocus, _key]: [number, boolean, string],
  ) => {
    let cells = el.querySelectorAll<HTMLElement>('[data-emoji-cell]');
    for (let i = 0; i < cells.length; i++) {
      cells[i]!.tabIndex = i === index ? 0 : -1;
    }
    if (shouldFocus) {
      cells[index]?.focus();
    }
  },
);

/**
 * Announce `text` once it has stopped changing for `delay` ms.
 *
 * Same one-shot contract as `estimateWhenIdle` in password-strength.gts, and
 * for the same realm-law reason: the modifier owns the handle, its destructor
 * clears it, and because the function form of `modifier` tears down before it
 * re-runs on an arg change, each new value cancels the pending call and arms
 * exactly one more. Nothing re-arms after teardown, so this cannot strand
 * `await settled()`.
 *
 * `run` is a positional arg rather than a captured closure so that identity
 * churn in the caller cannot retrigger the modifier every render.
 */
const announceWhenIdle = modifier(
  (
    _el: HTMLElement,
    [text, delay, run]: [string, number, (text: string) => void],
  ) => {
    let handle = setTimeout(() => run(text), delay);
    return () => clearTimeout(handle);
  },
);

/** Focus the element when `should` flips true. Local to avoid focus.gts's
 * `focusWhen`, which focuses on insert; the search field must only take focus
 * when the caller asked for it. */
const focusOnce = modifier((el: HTMLElement, [should]: [boolean]) => {
  if (should) {
    el.focus();
  }
});

// ── EmojiPicker ──────────────────────────────────────────────────────────

export interface EmojiPickerSignature {
  Args: {
    /** Called with the chosen emoji. The only required arg in practice. */
    onSelect?: (selection: EmojiSelection) => void;
    /** Active skin tone 0-5. Controlled when supplied. */
    skinTone?: number;
    /** Called when the tone changes; persist it to make the choice sticky. */
    onSkinTone?: (skinTone: number) => void;
    /**
     * Recently-used emoji, MOST RECENT FIRST, as untoned unicode strings.
     *
     * Ordering is positional and carries NO timestamp — `Date.now()` is
     * forbidden in realm code because it breaks indexing determinism, and a
     * wall clock was never needed: "most recent" is "index 0". Controlled
     * when supplied; otherwise the picker keeps its own list for the session.
     */
    recent?: readonly string[];
    /** Receives the new recent list after each pick. Persist it verbatim. */
    onRecent?: (recent: readonly string[]) => void;
    /** How many recent emoji to keep. Default 18. */
    recentLimit?: number;
    /** Columns in the grid. Default 9. */
    columns?: number;
    /** Focus the search field on insert. Default false. */
    autofocus?: boolean;
    /**
     * Pin the emoji version instead of detecting it. Detection draws fourteen
     * 1x1 canvases; pin it if a caller has already measured, or to make a
     * screenshot test deterministic across machines.
     */
    emojiVersion?: number;
    /** Accessible name for the whole picker. Default "Emoji picker". */
    label?: string;
  };
  Element: HTMLDivElement;
}

type Status = 'loading' | 'ready' | 'error';

interface Cell {
  emoji: Emoji;
  /** The glyph to paint, tone applied. */
  glyph: string;
  /** Flat index across the whole grid — the roving tabindex position. */
  index: number;
  key: string;
}

export class EmojiPicker extends Component<EmojiPickerSignature> {
  private guid = nextId();

  @tracked private status: Status = 'loading';
  @tracked private index: EmojiIndex | undefined;
  @tracked private errorMessage = '';
  @tracked private query = '';
  @tracked private group = EMOJI_GROUPS[0]!.id;
  @tracked private focusedIndex = 0;
  @tracked private gridHasFocus = false;
  @tracked private toneOpen = false;
  @tracked private toneActive = 0;
  @tracked private internalTone = 0;
  @tracked private internalRecent: readonly string[] = [];
  @tracked private announcement = '';
  /** The cell the preview row is describing — focused, or hovered. */
  @tracked private previewIndex = -1;

  // ── ids ────────────────────────────────────────────────────────────────
  get searchId() {
    return this.guid + '-search';
  }
  get panelId() {
    return this.guid + '-panel';
  }
  get hintId() {
    return this.guid + '-hint';
  }
  get toneButtonId() {
    return this.guid + '-tone';
  }
  get toneListId() {
    return this.guid + '-tones';
  }
  toneOptionId = (tone: number) => this.guid + '-tone-' + tone;
  tabId = (group: number) => this.guid + '-tab-' + group;

  get label(): string {
    return this.args.label ?? 'Emoji picker';
  }

  get columns(): number {
    let n = Math.trunc(this.args.columns ?? DEFAULT_COLUMNS);
    return Math.max(4, Math.min(16, Number.isFinite(n) ? n : DEFAULT_COLUMNS));
  }

  get skinTone(): number {
    let tone = this.args.skinTone ?? this.internalTone;
    return Math.max(0, Math.min(5, Math.trunc(tone) || 0));
  }

  get recent(): readonly string[] {
    return this.args.recent ?? this.internalRecent;
  }

  get recentLimit(): number {
    let n = Math.trunc(this.args.recentLimit ?? DEFAULT_RECENT_LIMIT);
    return Math.max(0, Math.min(64, Number.isFinite(n) ? n : DEFAULT_RECENT_LIMIT));
  }

  get searching(): boolean {
    return this.query.trim().length >= MIN_SEARCH_LENGTH;
  }

  get isLoading(): boolean {
    return this.status === 'loading';
  }

  get isError(): boolean {
    return this.status === 'error';
  }

  get shouldAutofocus(): boolean {
    return this.args.autofocus === true;
  }

  get rootStyle() {
    return cssStyleFrom([
      '--pretui-emoji-columns: ' + String(this.columns),
    ]);
  }

  // ── Load ───────────────────────────────────────────────────────────────

  /** Kicked off by the `buildIndex` modifier, so it only ever runs in a
   * browser. `cancelled` is the modifier's destroyed flag — checked after
   * every await so a picker torn down mid-load sets nothing. */
  private load = (cancelled: () => boolean) => {
    let version = this.args.emojiVersion;
    let supportLevel =
      typeof version === 'number' && Number.isFinite(version)
        ? version
        : detectSupportLevel();

    EmojiIndex.load(supportLevel)
      .then((index) => {
        if (cancelled() || this.isDestroying) {
          return;
        }
        this.index = index;
        this.status = 'ready';
        this.announcement = '';
      })
      .catch((error: unknown) => {
        if (cancelled() || this.isDestroying) {
          return;
        }
        // A picker that cannot load its data is a missing picker, not a
        // broken one — say so in text and keep the trigger usable.
        this.errorMessage =
          error instanceof Error ? error.message : 'Could not load emoji.';
        this.status = 'error';
      });
  };

  // ── Categories ─────────────────────────────────────────────────────────

  get tabs(): { id: number; key: string; sample: string; label: string }[] {
    let tabs: { id: number; key: string; sample: string; label: string }[] = [];
    if (this.recent.length) {
      tabs.push({
        id: RECENT_GROUP,
        key: 'recent',
        // A clock face, because there is no clock icon in icon-registry.gts
        // and an emoji tab strip is the one place a glyph is not a cop-out.
        sample: '\u{1F553}',
        label: 'Recently used',
      });
    }
    for (let group of EMOJI_GROUPS) {
      tabs.push({ id: group.id, key: group.key, sample: group.sample, label: group.label });
    }
    return tabs;
  }

  /** The selected tab, clamped — the recent tab disappears when the list is
   * empty, so a stale selection has to fall back to something real. */
  get activeGroup(): number {
    let tabs = this.tabs;
    return tabs.some((t) => t.id === this.group) ? this.group : tabs[0]!.id;
  }

  isSelectedTab = (id: number): boolean => !this.searching && id === this.activeGroup;

  get panelLabel(): string {
    if (this.searching) {
      return 'Search results';
    }
    return this.tabs.find((t) => t.id === this.activeGroup)?.label ?? 'Emoji';
  }

  // ── The current emoji list ─────────────────────────────────────────────

  private get emojis(): readonly Emoji[] {
    let index = this.index;
    if (!index) {
      return [];
    }
    if (this.searching) {
      return index.search(this.query);
    }
    if (this.activeGroup === RECENT_GROUP) {
      // Rehydrate from unicode. An emoji that has left the dataset, or that
      // this browser's font cannot draw, silently drops out rather than
      // rendering as tofu.
      let out: Emoji[] = [];
      for (let unicode of this.recent) {
        let emoji = index.byUnicode(unicode);
        if (emoji) {
          out.push(emoji);
        }
      }
      return out;
    }
    return index.byGroup(this.activeGroup);
  }

  get cells(): Cell[] {
    let tone = this.skinTone;
    return this.emojis.map((emoji, i) => ({
      emoji,
      glyph: toneOf(emoji, tone),
      index: i,
      key: emoji.unicode,
    }));
  }

  /** Chunked into `role='row'` groups. Recomputed on category / query /
   * tone change — never on arrow keys, which is why roving tabindex is
   * imperative. */
  get rows(): { key: string; cells: Cell[] }[] {
    let columns = this.columns;
    let cells = this.cells;
    let rows: { key: string; cells: Cell[] }[] = [];
    for (let i = 0; i < cells.length; i += columns) {
      let chunk = cells.slice(i, i + columns);
      rows.push({ key: chunk[0]!.key, cells: chunk });
    }
    return rows;
  }

  get isEmpty(): boolean {
    return this.status === 'ready' && this.cells.length === 0;
  }

  /** Change key for `rovingGrid`: any of these means the cell list moved. */
  get gridKey(): string {
    return (
      this.query + '|' + String(this.activeGroup) + '|' + String(this.skinTone) + '|' + String(this.cells.length)
    );
  }

  // ── Announcement ───────────────────────────────────────────────────────

  /** What the live region SHOULD say once things settle. Derived from
   * settled state only; the delay lives in `announceWhenIdle`, so nothing is
   * announced per keystroke. */
  get pendingAnnouncement(): string {
    if (this.status !== 'ready' || !this.searching) {
      return '';
    }
    let n = this.cells.length;
    if (n === 0) {
      return 'No emoji found';
    }
    // "emoji" is invariant in the plural, which is why this reads better than
    // DataComponent's generic pluraliser would ("1 emojis").
    return String(n) + ' emoji found';
  }

  setAnnouncement = (text: string) => {
    if (!this.isDestroying) {
      this.announcement = text;
    }
  };

  // ── Preview ────────────────────────────────────────────────────────────

  get preview(): Cell | undefined {
    let cells = this.cells;
    if (!cells.length) {
      return undefined;
    }
    let i = this.previewIndex >= 0 ? this.previewIndex : this.focusedIndex;
    return cells[Math.max(0, Math.min(cells.length - 1, i))];
  }

  setPreview = (index: number) => {
    this.previewIndex = index;
  };
  clearPreview = () => {
    this.previewIndex = -1;
  };

  // ── Search ─────────────────────────────────────────────────────────────

  onSearchInput = (event: Event) => {
    // Search is a Map lookup over an in-memory index, so it runs on every
    // keystroke with no debounce at all. Upstream debounces because its
    // search is an IndexedDB round trip — removing the data fetch removed the
    // reason for the timer, which is the single most dangerous thing a realm
    // component can hold.
    this.query = (event.target as HTMLInputElement).value;
    this.focusedIndex = 0;
    this.previewIndex = -1;
  };

  clearSearch = () => {
    this.query = '';
    this.focusedIndex = 0;
    this.previewIndex = -1;
    this.gridHasFocus = false;
  };

  onSearchKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    if (event.key === 'ArrowDown' || event.key === 'Enter') {
      if (this.cells.length) {
        event.preventDefault();
        this.focusedIndex = 0;
        this.gridHasFocus = true;
      }
      return;
    }
    if (event.key === 'Escape' && this.query !== '') {
      // Escape clears the field before it reaches whatever surface is hosting
      // the picker, so the first Escape does not also close the popover.
      event.preventDefault();
      event.stopPropagation();
      this.clearSearch();
    }
  };

  // ── Tabs ───────────────────────────────────────────────────────────────

  selectGroup = (id: number) => {
    this.group = id;
    this.query = '';
    this.focusedIndex = 0;
    this.previewIndex = -1;
    this.gridHasFocus = false;
  };

  onTabKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let tabs = this.tabs;
    let current = tabs.findIndex((t) => t.id === this.activeGroup);
    let next = current;
    switch (event.key) {
      case 'ArrowRight':
        next = (current + 1) % tabs.length;
        break;
      case 'ArrowLeft':
        next = (current - 1 + tabs.length) % tabs.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = tabs.length - 1;
        break;
      case 'ArrowDown':
        if (this.cells.length) {
          event.preventDefault();
          this.focusedIndex = 0;
          this.gridHasFocus = true;
        }
        return;
      default:
        return;
    }
    event.preventDefault();
    // Automatic activation: switching category is cheap and non-destructive,
    // which is the condition APG puts on selection-follows-focus for tabs.
    this.selectGroup(tabs[next]!.id);
    (event.currentTarget as HTMLElement)
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [next]?.focus();
  };

  // ── Grid keyboard ──────────────────────────────────────────────────────

  onGridKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let count = this.cells.length;
    if (!count) {
      return;
    }
    let columns = this.columns;
    let i = this.focusedIndex;
    let next = i;

    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(count - 1, i + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, i - 1);
        break;
      case 'ArrowDown':
        next = i + columns < count ? i + columns : i;
        break;
      case 'ArrowUp':
        if (i - columns < 0) {
          // Leaving the top row returns to the search field rather than
          // trapping focus — the grid is not a dialog.
          event.preventDefault();
          this.gridHasFocus = false;
          this.focusSearch();
          return;
        }
        next = i - columns;
        break;
      case 'Home':
        next = event.ctrlKey || event.metaKey ? 0 : i - (i % columns);
        break;
      case 'End':
        next =
          event.ctrlKey || event.metaKey
            ? count - 1
            : Math.min(count - 1, i - (i % columns) + columns - 1);
        break;
      case 'PageDown':
        next = Math.min(count - 1, i + columns * PAGE_ROWS);
        break;
      case 'PageUp':
        next = Math.max(0, i - columns * PAGE_ROWS);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.gridHasFocus = false;
        this.focusSearch();
        return;
      default:
        return;
    }
    event.preventDefault();
    this.focusedIndex = next;
    this.previewIndex = -1;
    this.gridHasFocus = true;
  };

  private focusSearch() {
    let root = document.getElementById(this.searchId);
    root?.focus();
  }

  /**
   * Keep the roving stop in step when focus arrives by any route we did not
   * initiate — a click, a Tab, a screen reader moving the virtual cursor.
   *
   * The equality guard is load-bearing, not defensive. `rovingGrid` READS
   * `focusedIndex` and then calls `focus()` on that cell, which fires this
   * handler synchronously inside the same render computation; writing the
   * value back there is a backtracking re-render and Glimmer asserts on it
   * ("you attempted to update `focusedIndex` … but it had already been used").
   * When the focus was ours the index already matches, so returning early
   * makes the self-inflicted case a no-op and leaves the genuine ones alone.
   */
  onCellFocus = (index: number) => {
    if (this.focusedIndex === index) {
      return;
    }
    this.focusedIndex = index;
    this.previewIndex = -1;
  };

  // ── Selection ──────────────────────────────────────────────────────────

  choose = (cell: Cell) => {
    let base = cell.emoji.unicode;
    // Recency is positional: drop any existing occurrence, put this one at
    // the front, trim to the limit. No timestamps, so the ordering is
    // reproducible and the realm's no-wall-clock law is satisfied by
    // construction rather than by care.
    let next = [base, ...this.recent.filter((u) => u !== base)].slice(
      0,
      this.recentLimit,
    );
    if (this.args.recent === undefined) {
      this.internalRecent = next;
    }
    this.args.onRecent?.(next);
    this.args.onSelect?.({
      unicode: cell.glyph,
      annotation: cell.emoji.annotation,
      base,
      skinTone: this.skinTone,
    });
  };

  // ── Skin tone ──────────────────────────────────────────────────────────

  get toneGlyph(): string {
    return applySkinTone(SKIN_TONE_SAMPLE, this.skinTone);
  }

  get toneLabel(): string {
    return 'Skin tone: ' + (SKIN_TONE_LABELS[this.skinTone] ?? 'Default');
  }

  get toneOptions(): { tone: number; glyph: string; label: string }[] {
    return SKIN_TONE_LABELS.map((label, tone) => ({
      tone,
      glyph: applySkinTone(SKIN_TONE_SAMPLE, tone),
      label,
    }));
  }

  get toneActiveId(): string {
    return this.toneOptionId(this.toneActive);
  }

  isActiveTone = (tone: number): boolean => tone === this.toneActive;

  toggleTones = () => {
    this.toneOpen = !this.toneOpen;
    if (this.toneOpen) {
      this.toneActive = this.skinTone;
    }
  };

  commitTone = (tone: number) => {
    if (this.args.skinTone === undefined) {
      this.internalTone = tone;
    }
    this.args.onSkinTone?.(tone);
    this.toneOpen = false;
    document.getElementById(this.toneButtonId)?.focus();
  };

  onToneKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    let last = SKIN_TONE_LABELS.length - 1;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        this.toneActive = Math.min(last, this.toneActive + 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        this.toneActive = Math.max(0, this.toneActive - 1);
        break;
      case 'Home':
        event.preventDefault();
        this.toneActive = 0;
        break;
      case 'End':
        event.preventDefault();
        this.toneActive = last;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        this.commitTone(this.toneActive);
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.toneOpen = false;
        document.getElementById(this.toneButtonId)?.focus();
        break;
      default:
    }
  };

  onToneButtonKeydown = (rawEvent: Event) => {
    let event = rawEvent as KeyboardEvent;
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!this.toneOpen) {
        this.toggleTones();
      }
    }
  };

  <template>
    <div
      class='pretui-emoji'
      role='group'
      aria-label={{this.label}}
      style={{this.rootStyle}}
      data-test-pretui-emoji-picker
      data-status={{this.status}}
      {{buildIndex this.load}}
      {{announceWhenIdle
        this.pendingAnnouncement
        ANNOUNCE_DELAY
        this.setAnnouncement
      }}
      ...attributes
    >
      <div class='epx-top'>
        <span class='epx-searchwrap'>
          <svg
            class='epx-magnifier'
            viewBox='0 0 16 16'
            aria-hidden='true'
            focusable='false'
          ><circle
              cx='7'
              cy='7'
              r='4.25'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
            /><path
              d='M10.2 10.2L14 14'
              fill='none'
              stroke='currentColor'
              stroke-width='1.5'
              stroke-linecap='round'
            /></svg>
          {{! A real <label>, visually hidden, rather than aria-label — realm
              lint counts aria-label beside a placeholder as two labels, and
              a placeholder was never a label. The visible hint is painted. }}
          <label for={{this.searchId}} class='epx-sr'>Search emoji</label>
          {{#unless this.query}}
            <span class='epx-ghost' aria-hidden='true'>Search emoji</span>
          {{/unless}}
          <input
            id={{this.searchId}}
            class='epx-search'
            type='search'
            autocomplete='off'
            autocapitalize='none'
            spellcheck='false'
            enterkeyhint='search'
            aria-controls={{this.panelId}}
            aria-describedby={{this.hintId}}
            value={{this.query}}
            data-test-pretui-emoji-search
            {{focusOnce this.shouldAutofocus}}
            {{on 'input' this.onSearchInput}}
            {{on 'keydown' this.onSearchKeydown}}
          />
          {{#if this.query}}
            <button
              type='button'
              class='epx-clear'
              aria-label='Clear search'
              data-test-pretui-emoji-clear
              {{on 'click' this.clearSearch}}
            >
              <svg
                width='12'
                height='12'
                viewBox='0 0 12 12'
                aria-hidden='true'
                focusable='false'
              ><path
                  d='M3 3l6 6M9 3l-6 6'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='1.5'
                  stroke-linecap='round'
                /></svg>
            </button>
          {{/if}}
        </span>

        <span class='epx-tonewrap'>
          <button
            type='button'
            id={{this.toneButtonId}}
            class='epx-tonebutton'
            aria-label={{this.toneLabel}}
            aria-haspopup='listbox'
            aria-expanded={{if this.toneOpen 'true' 'false'}}
            aria-controls={{this.toneListId}}
            data-test-pretui-emoji-tone-button
            {{on 'click' this.toggleTones}}
            {{on 'keydown' this.onToneButtonKeydown}}
          >
            <span class='epx-glyph' aria-hidden='true'>{{this.toneGlyph}}</span>
          </button>
          {{#if this.toneOpen}}
            <div
              id={{this.toneListId}}
              class='epx-tonelist'
              role='listbox'
              aria-label='Skin tones'
              aria-activedescendant={{this.toneActiveId}}
              tabindex='0'
              data-test-pretui-emoji-tone-list
              {{focusOnce true}}
              {{listen 'keydown' this.onToneKeydown}}
            >
              {{#each this.toneOptions key='tone' as |option|}}
                <div
                  id={{this.toneOptionId option.tone}}
                  class='epx-toneoption'
                  role='option'
                  aria-selected={{if (this.isActiveTone option.tone) 'true' 'false'}}
                  data-active={{if (this.isActiveTone option.tone) 'true'}}
                  data-test-pretui-emoji-tone-option
                  {{on 'click' (fn this.commitTone option.tone)}}
                >
                  <span class='epx-glyph' aria-hidden='true'>{{option.glyph}}</span>
                  <span class='epx-tonename'>{{option.label}}</span>
                </div>
              {{/each}}
            </div>
          {{/if}}
        </span>
      </div>

      <div
        class='epx-tabs'
        role='tablist'
        aria-label='Emoji categories'
        data-test-pretui-emoji-tabs
        {{listen 'keydown' this.onTabKeydown}}
      >
        {{#each this.tabs key='key' as |tab|}}
          <button
            type='button'
            role='tab'
            id={{this.tabId tab.id}}
            class='epx-tab'
            aria-label={{tab.label}}
            aria-selected={{if (this.isSelectedTab tab.id) 'true' 'false'}}
            aria-controls={{this.panelId}}
            tabindex={{if (this.isSelectedTab tab.id) '0' '-1'}}
            data-selected={{if (this.isSelectedTab tab.id) 'true'}}
            data-test-pretui-emoji-tab
            {{on 'click' (fn this.selectGroup tab.id)}}
          >
            <span class='epx-glyph' aria-hidden='true'>{{tab.sample}}</span>
          </button>
        {{/each}}
      </div>

      <span id={{this.hintId}} class='epx-sr'>Type to filter emoji, then press
        the down arrow to move into the grid.</span>

      <div
        id={{this.panelId}}
        class='epx-panel'
        role='tabpanel'
        aria-label={{this.panelLabel}}
        aria-busy={{if this.isLoading 'true' 'false'}}
        data-test-pretui-emoji-panel
      >
        {{#if this.isLoading}}
          <div class='epx-state' data-test-pretui-emoji-loading>
            <span class='epx-skeleton' aria-hidden='true'></span>
            <span class='epx-statetext'>Loading emoji…</span>
          </div>
        {{else if this.isError}}
          <div class='epx-state' data-test-pretui-emoji-error>
            <span class='epx-stateglyph' aria-hidden='true'>⚠</span>
            <span class='epx-statetext'>{{this.errorMessage}}</span>
          </div>
        {{else if this.isEmpty}}
          {{! A magnifier EMOJI as the empty-state icon was the one place in
              the kit where a colour pictogram stood in for an icon — and the
              worst possible place for it, because the grid it replaces is
              made of colour pictograms, so the mark had no figure/ground
              distinction from the content that was missing. The empty state
              now does what an empty state is for: name the term that found
              nothing, and offer the way out. }}
          <div class='epx-state' data-test-pretui-emoji-empty>
            <span class='epx-statetext'>No emoji match
              <span class='epx-stateterm'>{{this.query}}</span></span>
            <button
              type='button'
              class='epx-stateaction'
              data-test-pretui-emoji-empty-clear
              {{on 'click' this.clearSearch}}
            >Clear the search</button>
          </div>
        {{else}}
          <div
            class='epx-grid'
            role='grid'
            aria-label={{this.panelLabel}}
            aria-rowcount={{this.rows.length}}
            aria-colcount={{this.columns}}
            data-test-pretui-emoji-grid
            {{rovingGrid this.focusedIndex this.gridHasFocus this.gridKey}}
            {{listen 'keydown' this.onGridKeydown}}
            {{listen 'mouseleave' this.clearPreview}}
          >
            {{#each this.rows key='key' as |row|}}
              <div class='epx-row' role='row'>
                {{#each row.cells key='key' as |cell|}}
                  <button
                    type='button'
                    role='gridcell'
                    class='epx-cell'
                    aria-label={{cell.emoji.annotation}}
                    data-emoji-cell
                    data-test-pretui-emoji-cell
                    {{on 'click' (fn this.choose cell)}}
                    {{on 'focus' (fn this.onCellFocus cell.index)}}
                    {{on 'mouseenter' (fn this.setPreview cell.index)}}
                  >
                    <span class='epx-glyph' aria-hidden='true'>{{cell.glyph}}</span>
                  </button>
                {{/each}}
              </div>
            {{/each}}
          </div>
        {{/if}}
      </div>

      <div class='epx-preview' data-test-pretui-emoji-preview>
        {{#if this.preview}}
          <span class='epx-glyph epx-previewglyph' aria-hidden='true'>
            {{this.preview.glyph}}
          </span>
          <span class='epx-previewname'>{{this.preview.emoji.annotation}}</span>
        {{else}}
          <span class='epx-previewname epx-previewidle'>Pick an emoji</span>
        {{/if}}
      </div>

      {{! Polite, and only after the query has been still for a beat — a
          screen reader must not read a result count on every keystroke. }}
      <p class='epx-sr' role='status' data-test-pretui-emoji-live>
        {{this.announcement}}
      </p>
    </div>

    <style scoped>
      @layer PretComponent {
        /* Zero dark branches: every value is a token with a light-value
           fallback, so the theme frame re-dresses the picker without this file
           knowing a season exists. Upstream forks on prefers-color-scheme
           inside its shadow root, which is why a dark Pretui frame on a light
           OS gave you a light picker. */
        .pretui-emoji {
          --pretui-emoji-size: var(--pretui-emoji-cell, 2rem);
          --pretui-emoji-gap: 2px;

          display: flex;
          flex-direction: column;
          gap: 8px;
          inline-size: 100%;
          max-inline-size: var(--pretui-emoji-width, 22rem);
          padding: 10px;
          border-radius: var(--radius-surface, 12px);
          background: var(--card);
          color: var(--foreground);
          /* Law 1 — depth is hairline + shadow, never a contrast border. */
          box-shadow: var(
            --pretui-shadow-card,
            0 0 0 1px var(--border),
            0 1px 2px rgb(0 0 0 / 0.2),
            0 2px 6px rgb(0 0 0 / 0.2)
          );
          font-family: var(--font-sans);
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
        }

        .epx-sr {
          position: absolute;
          inline-size: 1px;
          block-size: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }

        /* ── Search row ─────────────────────────────────────────────────── */
        .epx-top {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .epx-searchwrap {
          position: relative;
          display: flex;
          align-items: center;
          flex: 1 1 auto;
          min-inline-size: 0;
        }

        .epx-magnifier {
          position: absolute;
          inset-inline-start: 8px;
          inline-size: 14px;
          block-size: 14px;
          color: var(--muted-foreground);
          pointer-events: none;
        }

        .epx-ghost {
          position: absolute;
          inset-inline-start: 28px;
          color: var(--muted-foreground);
          pointer-events: none;
        }

        .epx-search {
          inline-size: 100%;
          min-inline-size: 0;
          padding: 6px 28px 6px 28px;
          border: 0;
          border-radius: var(--radius);
          background: var(--field, var(--boxel-light));
          color: inherit;
          font: inherit;
          letter-spacing: inherit;
          box-shadow: inset 0 0 0 1px var(--input);
        }

        .epx-search::-webkit-search-cancel-button {
          /* The picker ships its own clear button, with an accessible name and
             a focus ring; the UA one has neither. */
          appearance: none;
        }

        .epx-search:focus-visible,
        .epx-tonebutton:focus-visible,
        .epx-tab:focus-visible,
        .epx-clear:focus-visible,
        .epx-cell:focus-visible,
        .epx-tonelist:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }

        .epx-clear {
          position: absolute;
          inset-inline-end: 4px;
          display: grid;
          place-items: center;
          inline-size: 20px;
          block-size: 20px;
          padding: 0;
          border: 0;
          border-radius: 999px;
          background: transparent;
          color: var(--muted-foreground);
          cursor: pointer;
        }

        .epx-clear:hover {
          background: var(--muted);
          color: var(--foreground);
        }

        /* ── Skin tone ──────────────────────────────────────────────────── */
        .epx-tonewrap {
          position: relative;
          flex: 0 0 auto;
        }

        .epx-tonebutton {
          display: grid;
          place-items: center;
          inline-size: var(--pretui-emoji-size);
          block-size: var(--pretui-emoji-size);
          padding: 0;
          border: 0;
          border-radius: var(--radius);
          background: transparent;
          cursor: pointer;
        }

        .epx-tonebutton:hover {
          background: var(--muted);
        }

        .epx-tonelist {
          position: absolute;
          inset-inline-end: 0;
          inset-block-start: calc(100% + 4px);
          /* The one place this component stacks: a panel floating over the
             picker's own content. Token first, literal fallback mandatory. */
          z-index: var(--pretui-z-dropdown, 60);
          display: flex;
          flex-direction: column;
          min-inline-size: 10rem;
          padding: 4px;
          border-radius: var(--radius);
          background: var(--popover);
          box-shadow: var(
            --pretui-shadow-overlay,
            0 0 0 1px var(--border),
            0 8px 28px rgb(0 0 0 / 0.34)
          );
        }

        .epx-toneoption {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 8px;
          border-radius: var(--radius-sm, 8px);
          cursor: pointer;
        }

        .epx-toneoption:hover,
        .epx-toneoption[data-active='true'] {
          background: var(--muted);
        }

        /* Never colour alone: the active tone is named in text beside the
           swatch and carries aria-selected. */
        .epx-tonename {
          color: var(--muted-foreground);
        }

        .epx-toneoption[data-active='true'] .epx-tonename {
          color: var(--foreground);
          font-weight: 600;
        }

        /* ── Category tabs ──────────────────────────────────────────────── */
        .epx-tabs {
          display: grid;
          grid-auto-flow: column;
          grid-auto-columns: 1fr;
          gap: 2px;
          padding-block-end: 6px;
          box-shadow: inset 0 -1px 0 var(--border);
        }

        .epx-tab {
          position: relative;
          display: grid;
          place-items: center;
          block-size: 1.75rem;
          padding: 0;
          border: 0;
          border-radius: var(--radius-sm, 8px);
          background: transparent;
          cursor: pointer;
          opacity: 0.55;
        }

        .epx-tab:hover {
          opacity: 1;
          background: var(--muted);
        }

        .epx-tab[data-selected='true'] {
          opacity: 1;
        }

        /* The selected tab is marked by an underline AND by full opacity, so
           the state survives greyscale. */
        .epx-tab[data-selected='true']::after {
          content: '';
          position: absolute;
          inset-block-end: -6px;
          inset-inline: 15%;
          block-size: 2px;
          border-radius: 2px;
          background: var(--primary);
        }

        /* ── Grid ───────────────────────────────────────────────────────── */
        .epx-panel {
          block-size: var(--pretui-emoji-height, 15rem);
          overflow-y: auto;
          overscroll-behavior: contain;
          scrollbar-width: thin;
        }

        .epx-grid {
          display: flex;
          flex-direction: column;
          gap: var(--pretui-emoji-gap);
        }

        .epx-row {
          display: grid;
          grid-template-columns: repeat(var(--pretui-emoji-columns, 9), 1fr);
          gap: var(--pretui-emoji-gap);
        }

        .epx-cell {
          display: grid;
          place-items: center;
          aspect-ratio: 1;
          min-block-size: var(--pretui-emoji-size);
          padding: 0;
          border: 0;
          border-radius: var(--radius-sm, 8px);
          background: transparent;
          cursor: pointer;
        }

        .epx-cell:hover {
          background: var(--muted);
        }

        /* Emoji are painted by the colour-emoji font, never by currentColor —
           a colour font ignores it, so a "muted" emoji is a myth. Opacity is
           the only honest channel. */
        .epx-glyph {
          font-family: var(
            --pretui-emoji-font,
            'Twemoji Mozilla',
            'Apple Color Emoji',
            'Segoe UI Emoji',
            'Segoe UI Symbol',
            'Noto Color Emoji',
            'EmojiOne Color',
            'Android Emoji',
            sans-serif
          );
          font-size: var(--pretui-emoji-glyph, 1.25rem);
          line-height: 1;
        }

        /* ── States ─────────────────────────────────────────────────────── */
        .epx-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          block-size: 100%;
          color: var(--muted-foreground);
        }

        .epx-stateglyph {
          font-size: 1.5rem;
        }

        /* Law 3: the term the reader typed is a machine value inside prose,
           so it is set in mono rather than quoted or emphasised. */
        .epx-stateterm {
          font-family: var(--font-mono);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--foreground);
        }

        .epx-stateaction {
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--pretui-primary-ink, var(--primary));
          text-decoration: underline;
          text-underline-offset: 2px;
          cursor: pointer;
        }
        .epx-stateaction:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
          border-radius: var(--radius-chip, 6px);
        }

        .epx-skeleton {
          inline-size: 60%;
          block-size: 8px;
          border-radius: 999px;
          background: var(--muted);
          animation: epx-pulse 1.4s ease-in-out infinite;
        }

        @keyframes epx-pulse {
          50% {
            opacity: 0.45;
          }
        }

        /* Reduced motion lands on the END state, never a frozen midpoint. */
        @media (prefers-reduced-motion: reduce) {
          .epx-skeleton {
            animation: none;
            opacity: 1;
          }
        }

        /* ── Preview ────────────────────────────────────────────────────── */
        .epx-preview {
          display: flex;
          align-items: center;
          gap: 8px;
          min-block-size: 1.5rem;
          padding-block-start: 6px;
          box-shadow: inset 0 1px 0 var(--border);
        }

        .epx-previewglyph {
          font-size: 1.25rem;
        }

        .epx-previewname {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--foreground);
        }

        .epx-previewidle {
          color: var(--muted-foreground);
        }

        /* Coarse pointers get 44px targets. A card knows its pane, not the
           viewport, so this is a pointer query, not a width query. */
        @media (any-pointer: coarse) {
          .pretui-emoji {
            --pretui-emoji-size: 2.75rem;
          }
        }
      }
    </style>
  </template>
}
