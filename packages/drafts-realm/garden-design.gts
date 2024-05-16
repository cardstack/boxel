import NumberField from 'https://cardstack.com/base/number';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { IconTrash } from '@cardstack/boxel-ui/icons';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';

interface Option {
  name: string;
  id: string;
  symbol: string;
}

const OPTIONS: Option[] = [
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
    <div
      class='garden-design'
      style='width:calc({{this.columns}} * {{this.unit}}px + 100px)'
    >
      <h2>{{this.title}}</h2>
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
                {{on 'dragstart' this.dragStartFromGrid}}
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
        {{#each OPTIONS as |option|}}
          <li>
            <span
              {{on 'dragstart' this.dragStart}}
              id={{option.id}}
              draggable='true'
              class='plant {{option.id}}'
            >
              {{option.symbol}}
            </span>
            {{option.name}}
          </li>
        {{/each}}
      </ul>
      <button {{on 'click' this.reset}}>Reset Design</button>
      <div
        class='compost'
        {{on 'dragover' this.dragover}}
        {{on 'drop' this.removeItem}}
      >
        <IconTrash width='25' height='25' />
        Compost
      </div>
    </div>
    <style>
      .garden-design {
        padding: 10px 50px;
      }
      .grid {
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
        margin: 20px 0;
        padding: 0;
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
      .compost {
        --icon-color: brown;
        margin-top: 20px;
        width: 150px;
        height: 70px;
        display: flex;
        justify-content: center;
        align-items: center;
        gap: 10px;
        background-color: linen;
        border: 3px dashed sandybrown;
        border-radius: 10px;
        color: brown;
        font-weight: bold;
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

  @tracked rows;
  @tracked columns;
  @tracked unit;
  @tracked gridStyle;
  @tracked gridMap: TrackedMap<string, Option | null>;
  @tracked optionsMap: Map<string, Option>;

  constructor(owner, args) {
    super(owner, args);
    this.rows = this.args.model.width ?? this.defaultSize;
    this.columns = this.args.model.length ?? this.defaultSize;
    this.unit = this.args.model.unitPx ?? this.defaultUnit;
    this.gridStyle = this.generateGridStyle();
    this.gridMap = new TrackedMap(
      this.generateGridIds().map((id) => [id, null]),
    );
    this.optionsMap = new Map(OPTIONS.map((el) => [el.id, el]));
  }

  get title() {
    return this.args.model.title ?? 'Untitled Garden';
  }

  generateGridStyle = () => {
    return htmlSafe(`
      grid-template-columns: repeat(${this.rows}, ${this.unit}px);
      grid-template-rows: repeat(${this.columns}, ${this.unit}px);
    `);
  };

  generateGridIds = () => {
    let ids: string[] = [];
    for (let col = 0; col < this.columns; col++) {
      for (let row = 0; row < this.rows; row++) {
        ids.push(`target-${row}-${col}`);
      }
    }
    return ids;
  };

  get gridItems() {
    let items: { id: string; content: Option | null }[] = [];
    [...this.gridMap.entries()].map(([key, val]) => {
      items.push({
        id: key,
        content: val,
      });
    });
    return items;
  }

  @action dragStart(ev) {
    ev.dataTransfer.setData('text/plain', ev.target.id);
    ev.dataTransfer.dropEffect = 'copy';
  }

  @action dragStartFromGrid(ev) {
    ev.dataTransfer.setData('text/plain', ev.target.parentElement.id);
    ev.dataTransfer.dropEffect = 'move';
  }

  @action dragover(ev) {
    ev.preventDefault();
  }

  @action dropItem(ev) {
    ev.preventDefault();
    let dropTargetId = ev.target.id;
    let dragItemId = ev.dataTransfer.getData('text/plain');
    let dragItem = this.optionsMap.get(dragItemId);

    let maybeCurrentValue = this.gridMap.get(dragItemId);

    if (this.optionsMap.has(dropTargetId)) {
      dropTargetId = ev.target.parentElement.id;
    }
    if (this.gridMap.has(dropTargetId)) {
      if (maybeCurrentValue) {
        this.gridMap.set(dragItemId, null);
        this.gridMap.set(dropTargetId, maybeCurrentValue);
      } else {
        this.gridMap.set(dropTargetId, dragItem);
      }
    }
  }

  @action removeItem(ev) {
    ev.preventDefault();
    let fromId = ev.dataTransfer.getData('text/plain');
    if (this.gridMap.has(fromId)) {
      this.gridMap.set(fromId, null);
    }
  }

  @action reset() {
    [...this.gridMap.keys()].map((key) => this.gridMap.set(key, null));
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
