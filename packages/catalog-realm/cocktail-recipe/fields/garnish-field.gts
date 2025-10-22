import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import LemonIcon from '@cardstack/boxel-icons/cherry';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { pick } from '@cardstack/boxel-ui/helpers';

export class GarnishField extends FieldDef {
  static displayName = 'Garnish';
  static icon = LemonIcon;

  @field garnishType = contains(StringField);
  @field preparation = contains(StringField);
  @field placement = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='garnish-display'>
        <div class='garnish-header'>
          <span class='garnish-icon'>🍋</span>
          <span class='garnish-name'>
            {{if @model.garnishType @model.garnishType 'Garnish not specified'}}
          </span>
        </div>

        {{#if @model.preparation}}
          <div class='garnish-detail'>
            <strong>Preparation:</strong>
            {{@model.preparation}}
          </div>
        {{/if}}

        {{#if @model.placement}}
          <div class='garnish-detail'>
            <strong>Placement:</strong>
            {{@model.placement}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        .garnish-display {
          background: rgba(212, 175, 55, 0.15);
          border: 1px solid rgba(212, 175, 55, 0.4);
          border-radius: 8px;
          padding: 1rem;
          font-family: 'Georgia', serif;
        }

        .garnish-header {
          display: flex;
          align-items: center;
          gap: 0.8rem;
          margin-bottom: 0.8rem;
        }

        .garnish-icon {
          font-size: 1.5rem;
        }

        .garnish-name {
          font-weight: bold;
          color: #d4af37;
          font-size: 1.1rem;
        }

        .garnish-detail {
          margin-bottom: 0.4rem;
          color: #e5e5e5;
          font-size: 0.9rem;
          line-height: 1.4;
        }

        .garnish-detail strong {
          color: #d4af37;
        }

        .garnish-detail:last-child {
          margin-bottom: 0;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='garnish-editor'>
        <label for='garnish-type-input'>Garnish Type</label>
        <input
          id='garnish-type-input'
          value={{@model.garnishType}}
          placeholder='Garnish type (e.g., Lemon twist, Cherry, Orange peel)'
          {{on 'input' (pick 'target.value' (fn @set 'garnishType'))}}
          class='garnish-input'
        />

        <label for='preparation-input'>Preparation</label>
        <input
          id='preparation-input'
          value={{@model.preparation}}
          placeholder="Preparation (e.g., 'Twist over drink', 'Muddle gently')"
          {{on 'input' (pick 'target.value' (fn @set 'preparation'))}}
          class='preparation-input'
        />

        <label for='placement-input'>Placement</label>
        <input
          id='placement-input'
          value={{@model.placement}}
          placeholder="Placement (e.g., 'On rim', 'In drink', 'Float on top')"
          {{on 'input' (pick 'target.value' (fn @set 'placement'))}}
          class='placement-input'
        />
      </div>

      <style scoped>
        .garnish-editor {
          display: flex;
          flex-direction: column;
          gap: 0.6rem;
          background: rgba(25, 25, 25, 0.8);
          padding: 1rem;
          border-radius: 6px;
          border: 1px solid #d4af37;
        }

        label {
          color: #d4af37;
          font-size: 0.9rem;
          font-weight: bold;
          margin-bottom: 0.2rem;
        }

        input {
          padding: 0.6rem;
          border: 1px solid #d4af37;
          border-radius: 4px;
          background: rgba(40, 40, 40, 0.9);
          color: var(--boxel-50);
          font-size: 0.9rem;
        }

        input::placeholder {
          color: #888;
          font-style: italic;
        }

        input:focus {
          outline: none;
          border-color: #ffd700;
          box-shadow: 0 0 8px rgba(212, 175, 55, 0.4);
        }
      </style>
    </template>
  };
}
