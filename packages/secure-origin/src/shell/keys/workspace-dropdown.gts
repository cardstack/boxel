// Picks a workspace, as the app's workspace dropdown does (the host's
// RealmDropdown, built from boxel-ui's dropdown, menu and realm icon): a
// trigger naming the chosen workspace, opening a list capped in height that
// scrolls, with a search field above it that filters by name, so a person
// with hundreds of workspaces finds one by typing. boxel-ui can't ship on the
// secure origin (ADR 008 §1.3), so its look is brought here.
//
// The app shows each workspace's icon image. The secure origin loads no
// realm or remote images, so each workspace gets a letter tile drawn here
// from its name instead. Two workspaces with the same name are told apart by
// their addresses, shown beneath it.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import Component from '@glimmer/component';
import { trackedObject } from '@ember/reactive/collections';

import DropdownArrowDown from '../../components/icons/dropdown-arrow-down.gts';
import { eq } from '../../helpers/truth-helpers.ts';
import { modifier } from '../../modifiers/modifier.ts';

export interface Workspace {
  url: string;
  name: string;
}

interface Signature {
  Args: {
    workspaces: Workspace[];
    selected: string | undefined;
    onSelect: (url: string) => void;
    // The id of the label that names the dropdown.
    labelId?: string;
  };
  Element: HTMLElement;
}

const TILE_COLOURS = 6;

// A workspace's address as shown beneath its name: its URL without the
// scheme.
export function addressOf(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

// The letter a workspace's tile shows, and which of the tile colours it
// takes, both from its name, so a workspace looks the same every time.
function tileOf(name: string): { letter: string; colour: number } {
  let letter = [...name.trim()][0]?.toUpperCase() ?? '?';
  let sum = [...name].reduce((n, ch) => n + (ch.codePointAt(0) ?? 0), 0);
  return { letter, colour: sum % TILE_COLOURS };
}

// Closes the list when a click lands outside the dropdown.
const closeOnOutsideClick = modifier(
  (element: HTMLElement, close: () => void) => {
    let listener = (event: MouseEvent) => {
      if (!element.contains(event.target as Node)) {
        close();
      }
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  },
);

const focusOnInsert = modifier((element: HTMLElement) => {
  element.focus();
});

// Hands the element to `keep`, so the dropdown can focus its trigger again.
const keepElement = modifier(
  (element: HTMLElement, keep: (element: HTMLElement) => void) => {
    keep(element);
  },
);

// Keeps the highlighted option in view as the arrow keys move it.
const scrollIntoViewWhen = modifier((element: HTMLElement, active: boolean) => {
  if (active) {
    element.scrollIntoView({ block: 'nearest' });
  }
});

export default class WorkspaceDropdown extends Component<Signature> {
  <template>
    <div class='workspace-dropdown' {{closeOnOutsideClick this.close}}>
      <button
        type='button'
        class='trigger'
        aria-haspopup='listbox'
        aria-expanded={{if this.state.open 'true' 'false'}}
        aria-labelledby={{@labelId}}
        data-test-workspace-dropdown-trigger
        {{keepElement this.keepTrigger}}
        {{on 'click' this.toggle}}
        {{on 'keydown' this.triggerKeydown}}
        ...attributes
      >
        {{#if this.selectedWorkspace}}
          <span
            class='tile colour-{{this.selectedTile.colour}}'
            aria-hidden='true'
          >{{this.selectedTile.letter}}</span>
          <span class='names'>
            <span
              class='selected-name'
              data-test-workspace-dropdown-selected
            >{{this.selectedWorkspace.name}}</span>
            {{#if (this.isAmbiguous this.selectedWorkspace)}}
              <span class='address' data-test-workspace-address>{{addressOf
                  this.selectedWorkspace.url
                }}</span>
            {{/if}}
          </span>
        {{else}}
          <span class='placeholder'>Select a workspace</span>
        {{/if}}
        <DropdownArrowDown
          class='arrow'
          width='13px'
          height='13px'
          aria-hidden='true'
        />
      </button>
      {{#if this.state.open}}
        <div class='content' data-test-workspace-dropdown-content>
          {{! Focus stays in the search field as the arrow keys move the
            highlight, so the field is the combobox and names the highlighted
            option for a screen reader to announce. }}
          <div class='search'>
            <input
              class='search-input'
              type='search'
              role='combobox'
              placeholder='Search workspaces'
              autocomplete='off'
              aria-label='Search workspaces'
              aria-autocomplete='list'
              aria-expanded='true'
              aria-controls='workspace-options'
              aria-activedescendant={{this.activeOptionId}}
              value={{this.state.term}}
              data-test-workspace-dropdown-search
              {{focusOnInsert}}
              {{on 'input' this.search}}
              {{on 'keydown' this.listKeydown}}
            />
          </div>
          {{#if this.filtered.length}}
            <ul
              id='workspace-options'
              class='options'
              role='listbox'
              aria-labelledby={{@labelId}}
            >
              {{#each this.filtered as |workspace index|}}
                <li
                  id={{this.optionId index}}
                  role='option'
                  class='option {{if (eq index this.state.active) "active"}}'
                  aria-selected={{if
                    (eq workspace.url @selected)
                    'true'
                    'false'
                  }}
                  data-test-workspace-option={{workspace.name}}
                  {{scrollIntoViewWhen (eq index this.state.active)}}
                  {{on 'click' (fn this.choose workspace.url)}}
                  {{on 'mousemove' (fn this.highlight index)}}
                >
                  <span
                    class='tile colour-{{this.tileColour workspace.name}}'
                    aria-hidden='true'
                  >{{this.tileLetter workspace.name}}</span>
                  <span class='names'>
                    <span class='option-name'>{{workspace.name}}</span>
                    {{#if (this.isAmbiguous workspace)}}
                      <span
                        class='address'
                        data-test-workspace-address
                      >{{addressOf workspace.url}}</span>
                    {{/if}}
                  </span>
                  {{#if (eq workspace.url @selected)}}
                    <span class='check' aria-hidden='true'>✓</span>
                  {{/if}}
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class='no-results' data-test-workspace-dropdown-no-results>
              {{#if this.state.term}}
                No workspaces match “{{this.state.term}}”
              {{else}}
                You don’t edit any workspace you could share a key into.
              {{/if}}
            </p>
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style scoped>
      .workspace-dropdown {
        position: relative;
        width: 100%;
      }
      .trigger {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-xs);
        width: 100%;
        min-height: var(--boxel-form-control-height);
        padding: var(--boxel-sp-5xs) var(--boxel-sp-xs);
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        border-radius: var(--boxel-border-radius);
        background-color: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
        text-align: start;
        cursor: pointer;
      }
      .trigger:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 1px;
      }
      .placeholder {
        grid-column: 1 / 3;
        font-weight: 400;
        color: var(--muted-foreground);
      }
      .names {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .selected-name,
      .option-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      /* An address wraps rather than being cut short, since the part that
         tells two workspaces apart may be at its end. */
      .address {
        overflow-wrap: anywhere;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        font-weight: 400;
        color: var(--muted-foreground);
      }
      .arrow {
        --icon-color: var(--foreground, var(--boxel-dark));
      }
      .trigger[aria-expanded='true'] .arrow {
        transform: scaleY(-1);
      }
      .content {
        position: absolute;
        z-index: 1;
        top: calc(100% + var(--boxel-sp-5xs));
        left: 0;
        right: 0;
        background-color: var(--background, var(--boxel-light));
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-box-shadow);
        overflow: hidden;
      }
      .search {
        padding: var(--boxel-sp-xxs);
        border-bottom: 1px solid var(--border, var(--boxel-200));
      }
      .search-input {
        width: 100%;
        height: 2rem;
        padding: 0 var(--boxel-sp-xs);
        border: 1px solid var(--border, var(--boxel-form-control-border-color));
        border-radius: var(--boxel-border-radius-sm);
        background-color: transparent;
        color: var(--foreground, var(--boxel-dark));
        font-family: inherit;
        font-size: var(--boxel-font-size-sm);
      }
      .options {
        list-style: none;
        margin: 0;
        padding: var(--boxel-sp-5xs) 0;
        max-height: 13rem;
        overflow-y: auto;
      }
      .option {
        display: grid;
        grid-template-columns: auto minmax(0, 1fr) auto;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        font-weight: 600;
        cursor: pointer;
      }
      .option.active {
        background-color: var(--muted, var(--boxel-100));
      }
      .check {
        font-size: var(--boxel-font-size-sm);
      }
      .no-results {
        margin: 0;
        padding: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        color: var(--muted-foreground);
      }
      .tile {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--boxel-icon-sm);
        height: var(--boxel-icon-sm);
        border-radius: var(--boxel-border-radius-xs);
        color: var(--boxel-light);
        font-size: var(--boxel-font-size-xs);
        line-height: 1;
        font-weight: 700;
      }
      .colour-0 {
        background-color: var(--boxel-purple);
      }
      .colour-1 {
        background-color: var(--boxel-dark-teal);
      }
      .colour-2 {
        background-color: var(--boxel-dark-red);
      }
      .colour-3 {
        background-color: var(--boxel-dark-amber);
      }
      .colour-4 {
        background-color: var(--boxel-dark-green);
      }
      .colour-5 {
        background-color: var(--boxel-450);
      }
    </style>
  </template>

  private state = trackedObject({ open: false, term: '', active: 0 });
  private trigger: HTMLElement | undefined;

  private keepTrigger = (element: HTMLElement) => {
    this.trigger = element;
  };

  private optionId = (index: number) => `workspace-option-${index}`;

  private get activeOptionId(): string | undefined {
    return this.filtered[this.state.active]
      ? this.optionId(this.state.active)
      : undefined;
  }

  private get selectedWorkspace() {
    return this.args.workspaces.find((w) => w.url === this.args.selected);
  }

  private get selectedTile() {
    return tileOf(this.selectedWorkspace?.name ?? '');
  }

  // Whether another workspace on offer has the same name.
  private isAmbiguous = (workspace: Workspace) =>
    this.args.workspaces.some(
      (w) => w.url !== workspace.url && w.name === workspace.name,
    );

  private tileLetter = (name: string) => tileOf(name).letter;
  private tileColour = (name: string) => tileOf(name).colour;

  private get filtered(): Workspace[] {
    let term = this.state.term.trim().toLowerCase();
    return term
      ? this.args.workspaces.filter((w) => w.name.toLowerCase().includes(term))
      : this.args.workspaces;
  }

  private open() {
    let selected = this.filtered.findIndex((w) => w.url === this.args.selected);
    this.state.term = '';
    this.state.active = Math.max(selected, 0);
    this.state.open = true;
  }

  private close = () => {
    this.state.open = false;
    this.state.term = '';
  };

  private toggle = () => {
    if (this.state.open) {
      this.close();
    } else {
      this.open();
    }
  };

  private triggerKeydown = (e: Event) => {
    let event = e as KeyboardEvent;
    if (
      !this.state.open &&
      (event.key === 'ArrowDown' || event.key === 'ArrowUp')
    ) {
      event.preventDefault();
      this.open();
    }
  };

  private search = (event: Event) => {
    this.state.term = (event.target as HTMLInputElement).value;
    this.state.active = 0;
  };

  private highlight = (index: number) => {
    this.state.active = index;
  };

  private choose = (url: string) => {
    this.args.onSelect(url);
    this.close();
  };

  // Closing from the keyboard removes the focused search field, so focus goes
  // back to the trigger rather than falling to the page.
  private closeToTrigger = () => {
    this.close();
    this.trigger?.focus();
  };

  private listKeydown = (e: Event) => {
    let event = e as KeyboardEvent;
    let count = this.filtered.length;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.state.active = count ? (this.state.active + 1) % count : 0;
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.state.active = count ? (this.state.active - 1 + count) % count : 0;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      let workspace = this.filtered[this.state.active];
      if (workspace) {
        this.args.onSelect(workspace.url);
        this.closeToTrigger();
      }
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.closeToTrigger();
    }
  };
}
