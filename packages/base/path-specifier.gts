import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import {
  fieldSerializer,
  parsePathPrefix,
  primitive,
} from '@cardstack/runtime-common';
import { Button } from '@cardstack/pretui/components/button';
import { IconButton } from '@cardstack/pretui/components/icon-button';
import { Input } from '@cardstack/pretui/components/input';
import { VisuallyHidden } from '@cardstack/pretui/components/visually-hidden';

import FolderSearchIcon from '@cardstack/boxel-icons/folder-search';
import PlusIcon from '@cardstack/boxel-icons/plus';
import TriangleAlertIcon from '@cardstack/boxel-icons/triangle-alert';
import XIcon from '@cardstack/boxel-icons/x';

import { cn } from '@cardstack/boxel-ui/helpers';

import { Component, FieldDef } from './card-api';

// A path specifier: a list of path prefixes, naming the set of paths in a
// realm that fall under any of them. `parsePathPrefix` in runtime-common's
// `path-specifier.ts` says what a prefix means and which ones are valid.
//
// The `path-specifier` serializer owns the stored value: the prefixes as a
// JSON array, exactly as written, or `null` when the specifier is unset. A
// malformed value fails the card rather than reading as unset. Both `null` and
// an empty list mean no path limit, so the view says so: emptying a specifier
// is the one edit that widens what it covers.
//
// It is a primitive field, not a compound one holding a
// `containsMany(StringField)`, because the stored value is read as JSON as
// well as through this field: the policy compile reads a card's attributes as
// stored, so the serializer's `asPrefixes` is the one reader both share. A
// compound field would store `{ prefixes: [...] }`, a shape only card-api's
// generic serialization defines; it would load list items of any type, since
// `StringField` has no serializer to refuse them; and it could never be unset.
//
// Nothing here rejects an invalid prefix. The editor stores what the author
// types and shows the validator's message under it, so a card holding an
// invalid prefix still saves and can be fixed later. Whatever reads the
// specifier decides what an invalid one means. The view marks an invalid
// prefix, so a specifier holding one doesn't read as a working path limit.

// The validator's message for an invalid prefix, or undefined for a valid one.
function messageFor(prefix: string): string | undefined {
  let result = parsePathPrefix(prefix);
  return result.ok ? undefined : result.error.message;
}

interface PrefixItem {
  prefix: string;
  message: string | undefined;
}

class View extends Component<typeof PathSpecifierField> {
  private get items(): PrefixItem[] {
    return (this.args.model ?? []).map((prefix) => ({
      prefix,
      message: messageFor(prefix),
    }));
  }

  <template>
    {{#if this.items.length}}
      <ul class='path-specifier' data-test-path-specifier>
        {{#each this.items as |item|~}}
          <li
            class={{cn 'item' invalid=item.message}}
            data-test-path-specifier-item
          >
            {{#if item.prefix}}
              {{! The interpolation sits flush against the tags: a prefix is
                shown as written, whitespace included. }}
              <code
                class='prefix'
                data-test-path-specifier-prefix
              >{{item.prefix}}</code>
            {{else}}
              <span class='prefix empty' data-test-path-specifier-empty>
                empty
              </span>
            {{/if}}
            {{#if item.message}}
              <span
                class='invalid-mark'
                title={{item.message}}
                aria-hidden='true'
              >
                <TriangleAlertIcon class='invalid-icon' />
              </span>
              <VisuallyHidden data-test-path-specifier-invalid>
                Invalid.
                {{item.message}}
              </VisuallyHidden>
            {{/if}}
          </li>
        {{~/each}}
      </ul>
    {{else}}
      <span class='no-limit' data-test-path-specifier-no-limit>
        No path limit
      </span>
    {{/if}}
    <style scoped>
      /* Inline, so that as an atom in a sentence the prefixes wrap with the
         text around them instead of moving to a line of their own. */
      .path-specifier {
        display: inline;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .item {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-4xs);
        max-width: 100%;
        margin-inline-end: var(--boxel-sp-xxs);
      }
      .item:last-child {
        margin-inline-end: 0;
      }
      .prefix {
        padding: 0 var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--muted);
        color: var(--foreground);
        font-family: var(--font-mono);
        font-size: var(--boxel-font-size-sm);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .empty {
        color: var(--muted-foreground);
        font-family: inherit;
        font-style: italic;
        white-space: normal;
      }
      .invalid .prefix {
        box-shadow: inset 0 0 0 1px var(--destructive);
      }
      .invalid-mark {
        display: inline-flex;
        flex-shrink: 0;
        color: var(--destructive-ink);
        font-size: var(--boxel-font-size-sm);
      }
      .invalid-icon {
        width: 1em;
        height: 1em;
      }
      .no-limit {
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

interface PrefixRow {
  prefix: string;
  index: number;
  draft: boolean;
  label: string;
  removeLabel: string;
  message: string | undefined;
}

function prefixRow(prefix: string, index: number, draft: boolean): PrefixRow {
  return {
    prefix,
    index,
    draft,
    label: `Path prefix ${index + 1}`,
    removeLabel: `Remove path prefix ${index + 1}`,
    message: draft ? undefined : messageFor(prefix),
  };
}

// Where the editor puts the cursor after a change. Each request is a new
// object, and the element it names takes it once, so a later render of that
// element doesn't take the focus again.
interface FocusRequest {
  target: 'input' | 'remove' | 'add';
  index?: number;
  taken?: boolean;
}

class Edit extends Component<typeof PathSpecifierField> {
  // Whether the author has added a row and not typed in it yet. An empty
  // prefix is invalid, so the new row isn't stored until it has content, and
  // it goes away if the author leaves it empty.
  @tracked private drafting = false;
  @tracked private focusRequest: FocusRequest | undefined;

  private get prefixes(): readonly string[] {
    return this.args.model ?? [];
  }

  private get rows(): PrefixRow[] {
    let rows = this.prefixes.map((prefix, index) =>
      prefixRow(prefix, index, false),
    );
    if (this.drafting) {
      rows.push(prefixRow('', rows.length, true));
    }
    return rows;
  }

  // The new row always comes after the stored prefixes.
  private get draftIndex(): number | undefined {
    return this.drafting ? this.prefixes.length : undefined;
  }

  private get readonly() {
    return !this.args.canEdit;
  }

  private setPrefix = (index: number, prefix: string) => {
    if (index === this.draftIndex) {
      if (prefix === '') {
        return;
      }
      this.drafting = false;
    }
    let next = [...this.prefixes];
    next[index] = prefix;
    this.args.set(next);
  };

  private addPrefix = () => {
    this.drafting = true;
    this.focusRequest = { target: 'input', index: this.prefixes.length };
  };

  // Removing the last prefix leaves an empty list, which means no path limit.
  private removePrefix = (index: number) => {
    let next = this.prefixes.filter((_, i) => i !== index);
    // The rows are keyed by position, so a removal takes the bottom row's
    // elements off the page. Removing any other row leaves the focus on the
    // same remove button, now in the row that moved up. Removing the bottom
    // row takes away the button that had the focus, so it goes to the row
    // above, or to Add when no rows are left.
    if (index === next.length) {
      this.focusRequest =
        index > 0 ? { target: 'remove', index: index - 1 } : { target: 'add' };
    }
    this.args.set(next);
  };

  private leaveRow = (index: number, event: FocusEvent) => {
    // An input keeps the focus while the window loses it: the author hasn't
    // left the row.
    if (event.target === document.activeElement) {
      return;
    }
    if (index === this.draftIndex) {
      this.drafting = false;
    }
  };

  private takeFocus = modifier(
    (
      element: HTMLElement,
      [request, target, index]: [
        FocusRequest | undefined,
        FocusRequest['target'],
        number?,
      ],
    ) => {
      if (
        request &&
        !request.taken &&
        request.target === target &&
        request.index === index
      ) {
        request.taken = true;
        element.focus();
      }
    },
  );

  <template>
    <div class='path-specifier-edit' data-test-path-specifier-edit>
      {{#if this.rows.length}}
        <ul class='rows'>
          {{! Keyed by position, so a row keeps its input, and the author's
            focus, while its prefix changes. }}
          {{#each this.rows key='@index' as |row|}}
            <li class='row' data-test-path-specifier-row={{row.index}}>
              <Input
                @value={{row.prefix}}
                @onInput={{fn this.setPrefix row.index}}
                @readonly={{this.readonly}}
                @invalid={{if row.message true false}}
                @errorMessage={{row.message}}
                @placeholder='blog/'
                aria-label={{row.label}}
                {{on 'blur' (fn this.leaveRow row.index)}}
                {{this.takeFocus this.focusRequest 'input' row.index}}
                data-test-path-specifier-input={{row.index}}
              />
              {{! A new row has nothing stored to remove until the author
                types in it. }}
              {{#if @canEdit}}
                {{#unless row.draft}}
                  <IconButton
                    @label={{row.removeLabel}}
                    @icon={{XIcon}}
                    @appearance='plain'
                    @size='s'
                    {{on 'click' (fn this.removePrefix row.index)}}
                    {{this.takeFocus this.focusRequest 'remove' row.index}}
                    data-test-path-specifier-remove={{row.index}}
                  />
                {{/unless}}
              {{/if}}
            </li>
          {{/each}}
        </ul>
      {{else}}
        <p class='no-limit' data-test-path-specifier-no-limit>
          No path limit
        </p>
      {{/if}}
      {{#if @canEdit}}
        <Button
          @icon={{PlusIcon}}
          @appearance='outlined'
          @size='s'
          {{on 'click' this.addPrefix}}
          {{this.takeFocus this.focusRequest 'add'}}
          data-test-path-specifier-add
        >
          Add path prefix
        </Button>
      {{/if}}
    </div>
    <style scoped>
      .path-specifier-edit {
        display: grid;
        justify-items: start;
        gap: var(--boxel-sp-xs);
      }
      .rows {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        justify-self: stretch;
        gap: var(--boxel-sp-xs) var(--boxel-sp-xxs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      /* The rows share the list's columns, so a new row's input, which has
         no remove button yet, lines up with the inputs above it. */
      .row {
        display: grid;
        grid-column: 1 / -1;
        grid-template-columns: subgrid;
        align-items: start;
      }
      .no-limit {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

export default class PathSpecifierField extends FieldDef {
  static displayName = 'Path Specifier';
  static icon = FolderSearchIcon;
  static [primitive]: string[];
  static [fieldSerializer] = 'path-specifier';
  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = Edit;
}
