import NumberField from 'https://cardstack.com/base/number';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
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
    <section
      class='garden-design'
      {{on 'dragover' this.dragover}}
      {{on 'drop' this.dropItem}}
    >
      <div>
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
                <button
                  {{on 'dragstart' this.dragStartFromGrid}}
                  id={{gridItem.content.id}}
                  draggable='true'
                  class='option {{gridItem.content.id}}'
                >
                  {{gridItem.content.symbol}}
                </button>
              {{/if}}
            </div>
          {{/each}}
        </div>
        <ul class='list'>
          {{#each OPTIONS as |option|}}
            <li>
              <button
                {{on 'dragstart' this.dragStart}}
                id={{option.id}}
                draggable='true'
                class='option {{option.id}}'
              >
                {{option.symbol}}
              </button>
              {{option.name}}
            </li>
          {{/each}}
        </ul>
        <button class='reset' {{on 'click' this.reset}}>Reset</button>
        <hr />
        <h4>Instructions:</h4>
        <ul>
          <li>Drag and drop circle icons from the list to the grid squares</li>
          <li>Drag and drop items within the grid to move or replace them</li>
          <li>Drag and drop items off the grid into the gray area to remove them</li>
          <li>Click "Reset" to clear the design</li>
        </ul>
      </div>
    </section>
    <style>
      .garden-design {
        width: 100%;
        height: 100%;
        background-color: whitesmoke;
        display: flex;
        justify-content: center;
        padding: 30px 50px;
      }
      h2 {
        margin-top: 0;
        margin-bottom: 20px;
      }
      .grid {
        background-color: white;
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
      .list {
        margin: 20px 0;
        padding: 0;
        height: 110px;
        display: flex;
        flex-direction: column;
        flex-wrap: wrap;
        gap: 10px;
      }
      .list > li {
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
      .option {
        width: 30px;
        height: 30px;
        border: 2px solid black;
        border-radius: 50%;
        display: flex;
        justify-content: center;
        align-items: center;
        font-weight: bold;
      }
      .option:hover {
        cursor: move;
        box-shadow: 0 1px 3px 0 rgba(0 0 0 / 50%);
      }
      .reset {
        margin: 30px 0 50px;
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

  constructor(owner: Owner, args: any) {
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

  @action dragStart(ev: DragEvent) {
    if (!ev.dataTransfer) {
      return;
    }
    ev.dataTransfer.setData('text/plain', (ev.target as HTMLElement).id);
    ev.dataTransfer.dropEffect = 'copy';
  }

  @action dragStartFromGrid(ev: DragEvent) {
    let id = (ev.target as HTMLElement)?.parentElement?.id;
    if (!ev.dataTransfer || !id) {
      return;
    }
    ev.dataTransfer.setData('text/plain', id);
    ev.dataTransfer.dropEffect = 'move';
  }

  @action dragover(ev: DragEvent) {
    ev.preventDefault();
  }

  @action dropItem(ev: DragEvent) {
    ev.preventDefault();
    let dropTargetId: string | undefined = (ev.target as HTMLElement).id;
    let dragItemId: string | undefined = ev.dataTransfer?.getData('text/plain');

    let dragItem;
    let maybeCurrentValue;

    if (dragItemId) {
      dragItem = this.optionsMap.get(dragItemId);
      // in dragStartFromGrid, dragItemId is set to the grid location id
      maybeCurrentValue = this.gridMap.get(dragItemId);
    }
    if (this.optionsMap.has(dropTargetId)) {
      // if the drop target has content, we need to get its grid location id
      dropTargetId = (ev.target as HTMLElement)?.parentElement?.id;
    }
    if (!dropTargetId || !this.gridMap.has(dropTargetId)) {
      if (maybeCurrentValue && dragItemId) {
        // item from the grid is dragged to unknown location, remove it from the grid
        this.gridMap.set(dragItemId, null);
      }
      return;
    }
    if (maybeCurrentValue && dragItemId) {
      // move item from one grid location to another
      this.gridMap.set(dragItemId, null);
      this.gridMap.set(dropTargetId, maybeCurrentValue);
      return;
    }

    if (dragItem) {
      this.gridMap.set(dropTargetId, dragItem);
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
