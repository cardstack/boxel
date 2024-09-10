import {
  contains,
  containsMany,
  linksTo,
  linksToMany,
  field,
  CardDef,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

/**
 * These imports *are* used, but a bug causes them to be flagged as unused
 * It seems related to the other issue of saying decorators are not valid
 */

// @ts-ignore  TS6133: 'action' is declared but its value is never read.
import { action } from '@ember/object';
// @ts-ignore  TS6133: 'tracked' is declared but its value is never read.
import { tracked } from '@glimmer/tracking';

export class Spell extends CardDef {
  @field name = contains(StringField);
  @field level = contains(NumberField);
  @field isPrepared = contains(BooleanField);
  @field damageDice = containsMany(StringField); // Field to store dice strings like "2d10", "1d8"
  @field spellDescription = contains(MarkdownField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <strong>{{@model.name}}</strong> (Level: {{@model.level}})
    </template>
  };

  static isolated = class Isolated extends Component<typeof this> {
    // @ts-ignore TS1206: Decorators are not valid here.
    @tracked rolls: { sides: number; roll: number; id: string }[] = [];
    // @ts-ignore TS1206: Decorators are not valid here.
    @tracked totalDamage = 0;
    // @ts-ignore TS1206: Decorators are not valid here.
    @tracked halfDamage = 0;

    rollDie(sides: number) {
      return Math.floor(Math.random() * sides) + 1;
    }

    parseDiceString(diceString: string) {
      const [count, sides] = diceString.split('d').map(Number);
      if (isNaN(count) || isNaN(sides) || count <= 0 || sides <= 0) {
        throw new Error(`Invalid dice notation: ${diceString}`);
      }
      return { count, sides };
    }

    calculateTotalDamage() {
      let totalDamage = this.rolls.reduce((sum, roll) => sum + roll.roll, 0);
      this.totalDamage = totalDamage;
      this.halfDamage = Math.floor(totalDamage / 2);
    }

    // @ts-ignore TS1206: Decorators are not valid here.
    @action
    calculateDamage() {
      let rolls: { sides: number; roll: number; id: string }[] = [];
      const diceStrings = this.args.model.damageDice || [];

      try {
        diceStrings.forEach((diceString) => {
          const { count, sides } = this.parseDiceString(diceString);
          for (let i = 0; i < count; i++) {
            const roll = this.rollDie(sides);
            rolls.push({ sides, roll, id: `${diceString}-${i}` });
          }
        });

        this.rolls = rolls;
        this.calculateTotalDamage();
      } catch (error) {
        console.error(error);
      }
    }

    // @ts-ignore TS1206: Decorators are not valid here.
    @action
    rerollDie(dieId: string) {
      let newRolls = this.rolls.map((roll) => {
        if (roll.id === dieId) {
          return { ...roll, roll: this.rollDie(roll.sides) };
        }
        return roll;
      });
      this.rolls = newRolls;
      this.calculateTotalDamage();
    }

    <template>
      <div class='spell-card'>
        <h1 class='spell-name'>{{@model.name}}</h1>
        <p class='spell-level'>Level: {{@model.level}}</p>
        <p class='spell-description'>{{@model.spellDescription}}</p>
        <button class='roll-button' {{on 'click' this.calculateDamage}}>Roll
          Damage</button>

        {{#if this.rolls.length}}
          <h2 class='damage-header'>Damage Rolls</h2>
          <ul class='roll-list'>
            {{#each this.rolls as |roll|}}
              <li>{{roll.roll}}
                (d{{roll.sides}})
                <button
                  class='reroll-button'
                  {{on 'click' (fn this.rerollDie roll.id)}}
                >Reroll</button>
              </li>
            {{/each}}
          </ul>
          <p class='total-damage'><strong>Total Damage:</strong>
            {{this.totalDamage}}</p>
          <p class='half-damage'><strong>Half Damage (on save):</strong>
            {{this.halfDamage}}</p>
        {{/if}}
      </div>

      <style scoped>
        .spell-card {
          font-family: 'Papyrus', fantasy;
          border: 2px solid #6b4226;
          border-radius: 8px;
          padding: 20px;
          max-width: 600px;
          margin: auto;
          color: #4b2e14;
        }

        .spell-name {
          font-size: 2em;
          text-align: center;
          margin-bottom: 10px;
        }

        .spell-level,
        .spell-description,
        .total-damage,
        .half-damage {
          font-size: 1.2em;
          margin-bottom: 10px;
        }

        .roll-button,
        .reroll-button {
          font-family: 'Papyrus', fantasy;
          background-color: #4b2e14;
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 20px;
          cursor: pointer;
        }

        .roll-button:hover,
        .reroll-button:hover {
          background-color: #6b4226;
        }

        .damage-header {
          text-align: center;
          margin-top: 20px;
          font-size: 1.5em;
        }

        .roll-list {
          list-style-type: none;
          padding: 0;
        }

        .roll-list li {
          display: flex;
          margin: 5px 0;
          justify-content: space-between;
          align-items: center;
        }

        .roll-list li button {
          padding: 5px 10px;
          margin-left: 10px;
        }
      </style>
    </template>
  };
}

// Define the Item card
export class DnDItem extends CardDef {
  @field name = contains(StringField);
  @field value = contains(NumberField);
}

// Define the InventoryItem card
export class InventoryItem extends CardDef {
  @field item = linksTo(DnDItem);
  @field quantity = contains(NumberField);
}

// Define the CharacterSheet card with attributes
export class CharacterSheet extends CardDef {
  @field name = contains(StringField);
  @field level = contains(NumberField);
  @field class = contains(StringField);
  @field race = contains(StringField);
  @field hitPoints = contains(NumberField);
  @field strength = contains(NumberField);
  @field dexterity = contains(NumberField);
  @field constitution = contains(NumberField);
  @field intelligence = contains(NumberField);
  @field wisdom = contains(NumberField);
  @field charisma = contains(NumberField);
  @field spells = linksToMany(Spell);
  @field inventory = linksToMany(InventoryItem);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      {{! Character Header Section }}
      <div class='character-header'>
        <h1>{{@model.name}}</h1>
        <h3>{{@model.title}}</h3>
        <p>{{@model.description}}</p>
      </div>

      {{! Character Basic Information Section }}
      <div class='character-info'>
        <div>
          <strong>Level:</strong>
          {{@model.level}}
        </div>
        <div>
          <strong>Class:</strong>
          {{@model.class}}
        </div>
        <div>
          <strong>Race:</strong>
          {{@model.race}}
        </div>
        <div>
          <strong>Hit Points:</strong>
          {{@model.hitPoints}}
        </div>
      </div>

      {{! Character Attributes Section }}
      <div class='character-attributes'>
        <h2>Attributes</h2>
        <div class='attribute-grid'>
          <div><strong>Strength:</strong> {{@model.strength}}</div>
          <div><strong>Dexterity:</strong> {{@model.dexterity}}</div>
          <div><strong>Constitution:</strong> {{@model.constitution}}</div>
          <div><strong>Intelligence:</strong> {{@model.intelligence}}</div>
          <div><strong>Wisdom:</strong> {{@model.wisdom}}</div>
          <div><strong>Charisma:</strong> {{@model.charisma}}</div>
        </div>
      </div>

      {{! Character Spells Section }}
      <div class='character-spells'>
        <h2>Spells</h2>
        <ul>
          {{#each @fields.spells as |SpellComponent|}}
            <li> <SpellComponent /> </li>
          {{/each}}
        </ul>
      </div>

      {{! Character Inventory Section }}
      <div class='character-inventory'>
        <h2>Inventory</h2>
        <ul>
          {{#each @model.inventory as |inventoryItem|}}
            <li>{{inventoryItem.item.name}}
              (Quantity:
              {{inventoryItem.quantity}})</li>
          {{/each}}
        </ul>
      </div>

      {{! CSS Styling }}
      <style scoped>
        body {
          font-family: 'Cinzel', serif; /* Classic fantasy font */
          background-color: #f5ecd3; /* Parchment background */
          color: #333333; /* Dark text for readability */
        }

        .character-header {
          text-align: center;
          margin-bottom: 30px;
          padding: 20px;
          border: 3px solid #8a4f7d;
          background-color: #fff8dc; /* Light parchment background */
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.5);
        }

        .character-info,
        .character-attributes,
        .character-spells,
        .character-inventory {
          margin: 20px;
          padding: 15px;
          border: 2px solid #8a4f7d;
          background-color: #fffaf0;
          border-radius: 10px;
          box-shadow: 0 0 10px rgba(0, 0, 0, 0.2);
        }

        .character-info {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 15px;
          justify-items: center;
        }

        .character-attributes {
          margin-top: 20px;
        }

        .attribute-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          text-align: center;
        }

        .character-info div,
        .character-attributes div {
          margin-bottom: 10px;
        }

        h1,
        h2,
        h3 {
          font-family: 'Cinzel Decorative', serif; /* Decorative header font */
        }

        h2 {
          border-bottom: 2px solid #8a4f7d;
          padding-bottom: 5px;
          margin-bottom: 15px;
          text-transform: uppercase;
        }

        ul {
          list-style: none;
          padding: 0;
        }

        ul li {
          background-color: #e6e2d3;
          padding: 10px;
          margin-bottom: 5px;
          border-radius: 5px;
          box-shadow: 0 0 5px rgba(0, 0, 0, 0.1);
        }

        ul li:nth-child(odd) {
          background-color: #d2ccc4;
        }

        ul li:nth-child(even) {
          background-color: #e6e2d3;
        }

        .character-header h1 {
          font-size: 2.5em;
          margin-bottom: 5px;
          color: #8a4f7d;
        }

        .character-header h3 {
          font-size: 1.5em;
          margin-bottom: 15px;
          color: #8a4f7d;
        }

        [hidden] {
          display: none !important;
        }
      </style>
    </template>
  };
}
