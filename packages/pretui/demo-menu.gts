// The usage pages this module used to hold now live in
// components/<slug>.usage.gts; what remains here is the fixtures they
// share. The header below describes those pages, not this file.
// Pretui — demo-menu: usage pages for the menu tier (menu.gts).
//
// Three pages, one data structure. The `MenuNode` tree defined once at the
// top of this file is handed unchanged to `Menu` and to `CommandPalette`, so
// the pages demonstrate the claim rather than restating it: a command defined
// once, with one shortcut and one enabled rule, shows up in both surfaces.
//
// The fiction is the sourcing desk from examples.gts — a lot document open on
// a trader's screen, with the menu a trader would actually pull down.
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { MenuEntry, ShortcutPlatform } from './internal/menu';

export const PLATFORM_OPTIONS = ['apple', 'other'];

/**
 * The whole taxonomy in one tree: commands with shortcuts, an ellipsis item,
 * a default (bold) item, a dynamic item that swaps while Option/Alt is held,
 * a checkmark toggle in mixed state, a radio group, a submenu, a section
 * header, a separator, and a destructive item sitting alone at the end.
 */
export class MenuState extends GlimmerComponent {
  @tracked align = 'start';
  @tracked platform: string = 'apple';
  @tracked notes: boolean | 'mixed' = 'mixed';
  @tracked grade = 'cupping';
  @tracked pinned = false;
  @tracked log = '—';
  @tracked paletteOpen = false;

  setAlign = (value: string) => (this.align = value);
  setPlatform = (value: string) => (this.platform = value);
  openPalette = () => (this.paletteOpen = true);
  closePalette = () => (this.paletteOpen = false);

  get alignValue() {
    return this.align as 'start' | 'end';
  }
  get platformValue() {
    return this.platform as ShortcutPlatform;
  }

  private ran = (what: string) => () => (this.log = what);

  // Handlers live OUT of the `items` getter: an assignment lexically inside a
  // getter is a side effect in a computed, which realm lint rejects — and it
  // is the right shape anyway, since the tree is data and these are actions.
  setNotes = (next: boolean) => {
    this.notes = next;
    this.log = next ? 'Cupping notes on' : 'Cupping notes off';
  };
  setPinned = (next: boolean) => {
    this.pinned = next;
    this.log = next ? 'Pinned to desk' : 'Unpinned';
  };
  sortByCupping = () => {
    this.grade = 'cupping';
    this.log = 'Sort: cupping score';
  };
  sortByArrival = () => {
    this.grade = 'arrival';
    this.log = 'Sort: arrival date';
  };
  sortByOrigin = () => {
    this.grade = 'origin';
    this.log = 'Sort: origin';
  };

  get items(): MenuEntry[] {
    return [
      {
        label: 'Open lot',
        kbd: 'Mod+O',
        isDefault: true,
        icon: 'rectangle-horizontal',
        onSelect: this.ran('Open lot'),
      },
      {
        label: 'Duplicate',
        kbd: 'Mod+D',
        icon: 'copy',
        // dynamic item: hold Option/Alt and this becomes "Duplicate 10×"
        alt: { label: 'Duplicate 10×', kbd: 'Mod+Alt+D' },
        onSelect: this.ran('Duplicate'),
      },
      {
        label: 'Rename',
        // the ellipsis is a promise that a dialog is coming — the component
        // appends U+2026 so no caller can type three periods instead
        needsInput: true,
        kbd: 'Enter',
        icon: 'pencil',
        onSelect: this.ran('Rename…'),
      },
      '---',
      {
        kind: 'toggle',
        label: 'Show cupping notes',
        kbd: 'Mod+Shift+N',
        checked: this.notes,
        description: 'Three of five selected lots have notes shown',
        onChange: this.setNotes,
      },
      {
        kind: 'toggle',
        label: 'Pin to desk',
        checked: this.pinned,
        onChange: this.setPinned,
      },
      '---',
      {
        kind: 'section',
        label: 'Sort by',
        items: [
          {
            kind: 'radio',
            group: 'grade',
            label: 'Cupping score',
            checked: this.grade === 'cupping',
            onSelect: this.sortByCupping,
          },
          {
            kind: 'radio',
            group: 'grade',
            label: 'Arrival date',
            checked: this.grade === 'arrival',
            onSelect: this.sortByArrival,
          },
          {
            kind: 'radio',
            group: 'grade',
            label: 'Origin',
            checked: this.grade === 'origin',
            onSelect: this.sortByOrigin,
          },
        ],
      },
      '---',
      {
        kind: 'submenu',
        label: 'Share',
        icon: 'send',
        items: [
          {
            label: 'Copy lot link',
            kbd: 'Mod+Shift+C',
            keywords: 'url permalink',
            onSelect: this.ran('Copy lot link'),
          },
          {
            label: 'Email the grower',
            needsInput: true,
            onSelect: this.ran('Email the grower…'),
          },
          '---',
          {
            kind: 'submenu',
            label: 'Export as',
            items: [
              { label: 'CSV', onSelect: this.ran('Export CSV') },
              { label: 'Contract PDF', onSelect: this.ran('Export PDF') },
            ],
          },
          {
            label: 'Publish to catalog',
            disabled: true,
            description: 'Needs a signed contract first',
          },
        ],
      },
      {
        label: 'Move to warehouse',
        kbd: 'Mod+M',
        disabled: true,
        onSelect: this.ran('Move'),
      },
      // HIG: destructive commands sit apart, below a separator, at the end —
      // never adjacent to a common command where a slip lands on them
      '---',
      {
        label: 'Withdraw lot',
        kbd: 'Mod+Backspace',
        destructive: true,
        needsInput: true,
        onSelect: this.ran('Withdraw lot…'),
      },
    ];
  }
}

