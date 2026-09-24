import { Component, FieldDef, primitive } from './card-api';
import {
  fieldSerializer,
  type PolicyPredicate,
} from '@cardstack/runtime-common';
import { BoxelInput, Button, Switch } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { not } from '@cardstack/boxel-ui/helpers';
import CodeIcon from '@cardstack/boxel-icons/code';

// A policy grant's `where` condition: a BXL boolean expression over the caller
// and the target, stored as source. The value is `{ source, snapshot }`; in a
// policy document it is a bare string of BXL, or `{ bxl, snapshot: true }` for
// a predicate that deliberately reads a snapshot value. The `policy-predicate`
// serializer owns both shapes.
//
// Nothing here parses, validates or evaluates the source; it is stored and
// shown exactly as written.

class View extends Component<typeof PolicyPredicateField> {
  <template>
    {{#if @model}}
      <span class='policy-predicate' data-test-policy-predicate>
        {{#if @model.source}}
          {{! The interpolation sits flush against the tags: .source preserves
            whitespace, so any indentation here would render as part of the
            predicate. }}
          <code
            class='source'
            data-test-policy-predicate-source
          >{{@model.source}}</code>
        {{else}}
          <span class='empty' data-test-policy-predicate-empty>
            empty condition
          </span>
        {{/if}}
        {{#if @model.snapshot}}
          <span class='snapshot' data-test-policy-predicate-snapshot>
            snapshot
          </span>
        {{/if}}
      </span>
    {{/if}}
    <style scoped>
      .policy-predicate {
        display: inline-flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
      }
      .source {
        font-family: var(--boxel-monospace-font-family, monospace);
        font-size: var(--boxel-font-size-sm);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .empty {
        font-style: italic;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .snapshot {
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
        text-transform: uppercase;
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}

class Edit extends Component<typeof PolicyPredicateField> {
  // Emptying the text keeps the predicate, as an empty one: an author
  // rewriting a condition passes through the empty state, and an unset
  // predicate is an unconditional grant. Removing the condition is its own
  // explicit action.
  private setSource = (source: string) => {
    this.args.set({ source, snapshot: this.args.model?.snapshot ?? false });
  };

  private removeCondition = () => {
    this.args.set(null);
  };

  private setSnapshot = (snapshot: boolean) => {
    if (!this.args.model) {
      return;
    }
    this.args.set({ source: this.args.model.source, snapshot });
  };

  <template>
    <div class='policy-predicate-edit'>
      <BoxelInput
        class='source'
        @type='textarea'
        @value={{@model.source}}
        @onInput={{this.setSource}}
        @readonly={{not @canEdit}}
        @placeholder={{if @model 'Empty condition' 'Always allowed'}}
        data-test-policy-predicate-input
      />
      <div class='snapshot'>
        <Switch
          @isEnabled={{if @model.snapshot true false}}
          @onChange={{this.setSnapshot}}
          @disabled={{if @model (not @canEdit) true}}
          @size='small'
          @label='Reads a snapshot value'
          data-test-policy-predicate-snapshot-toggle
        />
        <span aria-hidden='true'>Reads a snapshot value</span>
      </div>
      {{#if @model}}
        {{#if @canEdit}}
          <Button
            class='remove'
            @kind='text-only'
            @size='extra-small'
            {{on 'click' this.removeCondition}}
            data-test-policy-predicate-remove
          >
            Remove condition (always allow)
          </Button>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
      .policy-predicate-edit {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .source {
        font-family: var(--boxel-monospace-font-family, monospace);
      }
      .snapshot {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
      }
      .remove {
        justify-self: start;
      }
    </style>
  </template>
}

export default class PolicyPredicateField extends FieldDef {
  static displayName = 'Policy Predicate';
  static icon = CodeIcon;
  static [primitive]: PolicyPredicate;
  static [fieldSerializer] = 'policy-predicate';
  static embedded = View;
  static atom = View;
  static fitted = View;
  static edit = Edit;
}
