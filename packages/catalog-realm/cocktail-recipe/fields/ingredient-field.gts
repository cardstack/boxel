import {
  FieldDef,
  field,
  contains,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BottleIcon from '@cardstack/boxel-icons/wine';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { pick } from '@cardstack/boxel-ui/helpers';

export class IngredientField extends FieldDef {
  static displayName = 'Ingredient';
  static icon = BottleIcon;

  @field ingredient = contains(StringField);
  @field amount = contains(NumberField);
  @field unit = contains(StringField);
  @field notes = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class='ingredient-item'>
        <div class='ingredient-main'>
          <span class='amount'>
            {{if @model.amount @model.amount '?'}}
            {{if @model.unit @model.unit 'unit'}}
          </span>
          <span class='ingredient-name'>
            {{if @model.ingredient @model.ingredient 'Unknown ingredient'}}
          </span>
        </div>
        {{#if @model.notes}}
          <div class='ingredient-notes'>
            <em>{{@model.notes}}</em>
          </div>
        {{/if}}
      </div>

      <style scoped>
        .ingredient-item {
          background: rgba(212, 175, 55, 0.1);
          border: 1px solid rgba(212, 175, 55, 0.3);
          border-radius: 6px;
          padding: 0.8rem;
          font-family: 'Georgia', serif;
        }

        .ingredient-main {
          display: flex;
          gap: 0.8rem;
          align-items: baseline;
        }

        .amount {
          font-weight: bold;
          color: #d4af37;
          font-size: 0.9rem;
          min-width: 4rem;
          text-align: right;
        }

        .ingredient-name {
          color: var(--boxel-50);
          font-size: 1rem;
          flex: 1;
        }

        .ingredient-notes {
          margin-top: 0.4rem;
          color: #ccc;
          font-size: 0.8rem;
          padding-left: 4.8rem;
        }
      </style>
    </template>
  };

  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='ingredient-editor'>
        <div class='amount-row'>
          <label for='amount-input'>Amount</label>
          <label for='unit-input'>Unit</label>
        </div>
        <div class='amount-row'>
          <input
            id='amount-input'
            type='number'
            value={{@model.amount}}
            placeholder='Amount'
            step='0.25'
            {{on 'input' (pick 'target.value' (fn @set 'amount'))}}
            class='amount-input'
          />
          <input
            id='unit-input'
            value={{@model.unit}}
            placeholder='Unit (oz, cl, dash)'
            {{on 'input' (pick 'target.value' (fn @set 'unit'))}}
            class='unit-input'
          />
        </div>

        <label for='ingredient-input'>Ingredient</label>
        <input
          id='ingredient-input'
          value={{@model.ingredient}}
          placeholder='Ingredient name (e.g., Bourbon, Simple syrup)'
          {{on 'input' (pick 'target.value' (fn @set 'ingredient'))}}
          class='ingredient-input'
        />

        <label for='notes-input'>Notes</label>
        <input
          id='notes-input'
          value={{@model.notes}}
          placeholder="Notes (optional - e.g., 'freshly squeezed', 'top shelf')"
          {{on 'input' (pick 'target.value' (fn @set 'notes'))}}
          class='notes-input'
        />
      </div>

      <style scoped>
        .ingredient-editor {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          background: rgba(25, 25, 25, 0.8);
          padding: 1rem;
          border-radius: 6px;
          border: 1px solid #d4af37;
        }

        .amount-row {
          display: flex;
          gap: 0.5rem;
        }

        .amount-row:first-child {
          margin-bottom: 0.2rem;
        }

        .amount-row:first-child label {
          color: #d4af37;
          font-size: 0.9rem;
          font-weight: bold;
        }

        .amount-row:first-child label:first-child {
          width: 5rem;
        }

        .amount-row:first-child label:last-child {
          width: 8rem;
        }

        .amount-input {
          width: 5rem;
        }

        .unit-input {
          width: 8rem;
        }

        .ingredient-input {
          flex: 1;
        }

        label {
          color: #d4af37;
          font-size: 0.9rem;
          font-weight: bold;
          margin-bottom: 0.2rem;
        }

        input {
          padding: 0.5rem;
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
