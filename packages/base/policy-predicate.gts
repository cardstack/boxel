import { Component, FieldDef, primitive } from './card-api';
import {
  fieldSerializer,
  type PolicyPredicate,
} from '@cardstack/runtime-common';
import { BoxelInput, Switch } from '@cardstack/boxel-ui/components';
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
        <code class='source' data-test-policy-predicate-source>
          {{@model.source}}
        </code>
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
  // Clearing the source clears the predicate, which makes the grant
  // unconditional. An empty field is what "no condition" looks like to an
  // author, so that is what it stores.
  private setSource = (source: string) => {
    if (source === '') {
      this.args.set(null);
      return;
    }
    this.args.set({ source, snapshot: this.args.model?.snapshot ?? false });
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
        @placeholder='Always allowed'
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
