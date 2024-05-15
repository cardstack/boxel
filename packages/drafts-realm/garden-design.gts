import NumberField from 'https://cardstack.com/base/number';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';

const OPTIONS = [
  {
    name: 'Smooth Penstemon',
    id: 'smooth-penstemon',
    symbol: 'A',
  },
  {
    name: 'Purple Coneflower',
    id: 'purple-coneflower',
    symbol: 'B',
  },
  {
    name: 'Royal Catchfly',
    id: 'royal-catchfly',
    symbol: 'C',
  },
  {
    name: 'Black-Eyed Susan',
    id: 'black-eyed-susan',
    symbol: 'D',
  },
  {
    name: 'Lavender Hyssop',
    id: 'lavender-hyssop',
    symbol: 'E',
  },
  {
    name: 'Prairie Smoke',
    id: 'prairie-smoke',
    symbol: 'F',
  },
  {
    name: 'Birdbath',
    id: 'birdbath',
    symbol: 'BB',
  },
];

class Isolated extends Component<typeof GardenDesign> {
  <template>
    <div class='grid' style={{this.gridStyle}}>
      {{#each this.gridItems as |gridItem|}}
        <div
          class='grid-item'
          id={{gridItem.id}}
          {{on 'dragover' this.dragover}}
          {{on 'drop' this.dropItem}}
        >
          {{#if gridItem.content}}
            <span
              {{on 'dragstart' this.dragStart}}
              id={{gridItem.content.id}}
              draggable='true'
              class='plant {{gridItem.content.id}}'
            >
              {{gridItem.content.symbol}}
            </span>
          {{/if}}
        </div>
      {{/each}}
    </div>
    <ul>
      {{#each this.items as |item|}}
        <li>
          <span
            {{on 'dragstart' this.dragStart}}
            id={{item.id}}
            draggable='true'
            class='plant {{item.id}}'
          >{{item.symbol}}</span>
          {{item.name}}
        </li>
      {{/each}}
    </ul>
    <style>
      .grid {
        margin: 20px auto;
        width: max-content;
        border: 2px solid green;
        display: grid;
      }
      .grid-item {
        border: 1px solid black;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      ul {
        height: 140px;
        display: flex;
        flex-direction: column;
        flex-wrap: wrap;
        gap: 10px;
      }
      li {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .plant {
        width: 30px;
        height: 30px;
        border: 2px solid black;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        font-weight: bold;
      }
      .smooth-penstemon {
        background-color: whitesmoke;
        border-color: rosybrown;
        color: indianred;
      }
      .purple-coneflower {
        background-color: orchid;
        border-color: mediumorchid;
        color: lavenderblush;
      }
      .black-eyed-susan {
        background-color: palegoldenrod;
        border-color: goldenrod;
        color: darkgoldenrod;
      }
      .lavender-hyssop {
        background-color: lavender;
        border-color: purple;
        color: indigo;
      }
      .royal-catchfly {
        background-color: mistyrose;
        border-color: red;
        color: red;
      }
      .prairie-smoke {
        background-color: lightpink;
        border-color: deeppink;
        color: deeppink;
      }
      .birdbath {
        background-color: lightgray;
      }
    </style>
  </template>

  defaultUnit = 30;
  defaultSize = 10;
  items = OPTIONS;
  @tracked gridStyle;
  @tracked rows = this.defaultSize;
  @tracked columns = this.defaultSize;
  @tracked unit = this.defaultUnit;
  @tracked gridContentMap = new Map();
  @tracked gridItems: { id: string; content?: any }[] = [];
  @tracked _itemsMap = new Map();

  constructor(owner, args) {
    super(owner, args);
    this.rows = this.args.model.width ?? this.defaultSize;
    this.columns = this.args.model.length ?? this.defaultSize;
    this.unit = this.args.model.unitPx ?? this.defaultUnit;
    this.gridStyle = this.generateGrid();
    this.generateGridItems();
  }

  generateGrid = () => {
    return htmlSafe(`
      grid-template-columns: repeat(${this.rows}, ${this.unit}px);
      grid-template-rows: repeat(${this.columns}, ${this.unit}px);
    `);
  };

  generateGridItems = () => {
    for (let col = 0; col < this.columns; col++) {
      for (let row = 0; row < this.rows; row++) {
        let id = `target-${row}-${col}`;
        if (!this.gridContentMap.has(id)) {
          this.gridContentMap.set(`target-${row}-${col}`, null);
        }
      }
    }
    this.updateGridItems();
  };

  updateGridItems = () => {
    this.gridItems = [];
    [...this.gridContentMap.entries()].map(([key, val]) => {
      this.gridItems.push({
        id: key,
        content: val,
      });
    });
  };

  get itemsMap() {
    this.items.map((el) => {
      if (!this._itemsMap.has(el.id)) {
        this._itemsMap.set(el.id, {
          name: el.name,
          symbol: el.symbol,
        });
      }
    });
    return this._itemsMap;
  }

  @action dragStart(ev) {
    ev.dataTransfer.setData('text/plain', ev.target.id);
    ev.dataTransfer.dropEffect = 'move';
  }

  @action dragover(ev) {
    ev.preventDefault();
  }

  @action dropItem(ev) {
    ev.preventDefault();
    let targetId = ev.target.id;
    let id = ev.dataTransfer.getData('text/plain');
    let itemValue = this.itemsMap.get(id);
    this.gridContentMap.set(targetId, { id, ...itemValue });
    this.updateGridItems();
  }
}

export class GardenDesign extends CardDef {
  @field width = contains(NumberField);
  @field length = contains(NumberField);
  @field unitPx = contains(NumberField);
  static displayName = 'Garden Design';
  static isolated = Isolated;
  /*
  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }




















  */
}
