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

import FolderSearchIcon from '@cardstack/boxel-icons/folder-search';
import PlusIcon from '@cardstack/boxel-icons/plus';
import XIcon from '@cardstack/boxel-icons/x';

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
// specifier decides what an invalid one means.

class View extends Component<typeof PathSpecifierField> {
  <template>
    {{#if @model.length}}
      <ul class='path-specifier' data-test-path-specifier>
        {{#each @model as |prefix|}}
          <li>
            {{! The interpolation sits flush against the tags: a prefix is
              shown as written, whitespace included. }}
            <code
              class='prefix'
              data-test-path-specifier-prefix
            >{{prefix}}</code>
          </li>
        {{/each}}
      </ul>
    {{else}}
      <span class='no-limit' data-test-path-specifier-no-limit>
        No path limit
      </span>
    {{/if}}
    <style scoped>
      .path-specifier {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .prefix {
        padding: 0 var(--boxel-sp-4xs);
        border-radius: var(--boxel-border-radius-xs);
        background-color: var(--muted);
        color: var(--foreground);
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-sm);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
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
  label: string;
  removeLabel: string;
  message: string | undefined;
}

class Edit extends Component<typeof PathSpecifierField> {
  // The position of a row the author has just added and not yet left. A new
  // row starts empty, and an empty prefix is invalid, so the row holds back
  // that message until the author moves on from it.
  @tracked private addedRow: number | undefined;

  private get prefixes(): readonly string[] {
    return this.args.model ?? [];
  }

  private get rows(): PrefixRow[] {
    return this.prefixes.map((prefix, index) => ({
      prefix,
      index,
      label: `Path prefix ${index + 1}`,
      removeLabel: `Remove path prefix ${index + 1}`,
      message: this.messageFor(prefix, index),
    }));
  }

  private get readonly() {
    return !this.args.canEdit;
  }

  private messageFor(prefix: string, index: number): string | undefined {
    if (prefix === '' && index === this.addedRow) {
      return undefined;
    }
    let result = parsePathPrefix(prefix);
    return result.ok ? undefined : result.error.message;
  }

  private setPrefix = (index: number, prefix: string) => {
    let next = [...this.prefixes];
    next[index] = prefix;
    this.args.set(next);
  };

  private addPrefix = () => {
    this.addedRow = this.prefixes.length;
    this.args.set([...this.prefixes, '']);
  };

  // Removing the last prefix leaves an empty list, which means no path limit.
  private removePrefix = (index: number) => {
    if (this.addedRow === index) {
      this.addedRow = undefined;
    } else if (this.addedRow !== undefined && this.addedRow > index) {
      this.addedRow--;
    }
    this.args.set(this.prefixes.filter((_, i) => i !== index));
  };

  private leaveRow = (index: number) => {
    if (index === this.addedRow) {
      this.addedRow = undefined;
    }
  };

  // Puts the cursor in the row the author just added.
  private focusAddedRow = modifier(
    (element: HTMLElement, [index, addedRow]: [number, number | undefined]) => {
      if (index === addedRow) {
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
                {{this.focusAddedRow row.index this.addedRow}}
                data-test-path-specifier-input={{row.index}}
              />
              {{#if @canEdit}}
                <IconButton
                  @label={{row.removeLabel}}
                  @icon={{XIcon}}
                  @appearance='plain'
                  @size='s'
                  {{on 'click' (fn this.removePrefix row.index)}}
                  data-test-path-specifier-remove={{row.index}}
                />
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
        justify-self: stretch;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: start;
        gap: var(--boxel-sp-xxs);
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
