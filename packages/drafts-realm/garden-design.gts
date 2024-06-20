import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';
import {
  CardDef,
  field,
  contains,
  realmURL,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { Position, PositionedCard } from 'https://cardstack.com/base/position';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { getLiveCards } from '@cardstack/runtime-common';

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
                  id={{gridItem.content.gardenItemId}}
                  draggable='true'
                  class='option {{gridItem.content.gardenItemId}}'
                >
                  {{gridItem.content.symbol}}
                </button>
              {{/if}}
            </div>
          {{/each}}
        </div>
        <ul class='list'>
          {{#each this.options as |option|}}
            <li>
              <button
                {{on 'dragstart' this.dragStart}}
                id={{option.gardenItemId}}
                draggable='true'
                class='option {{option.gardenItemId}}'
              >
                {{option.symbol}}
              </button>
              {{option.name}}
            </li>
          {{else}}{{#if this.liveQuery.isLoading}}
              Loading...
            {{/if}}{{/each}}
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

  defaultCount = 10;
  defaultUnitSize = 50;

  @tracked cols = this.args.model.columns ?? this.defaultCount;
  @tracked rows = this.args.model.rows ?? this.defaultCount;
  @tracked gridStyle = htmlSafe(`
    grid-template-columns: repeat(${this.cols}, ${this.defaultUnitSize}px);
    grid-template-rows: repeat(${this.rows}, ${this.defaultUnitSize}px);
  `);
  @tracked gridMap: TrackedMap<string, GardenItem | null>;

  @tracked
  private declare liveQuery: {
    instances: CardDef[];
    isLoading: boolean;
  };

  constructor(owner: Owner, args: any) {
    super(owner, args);
    this.gridMap = new TrackedMap(
      this.generateGridIds().map((id) => {
        let maybeOption = this._gridModel.find(
          (el) => this.composeId(el.position.x, el.position.y) === id,
        );
        return [id, maybeOption ? (maybeOption.card as GardenItem) : null];
      }),
    );
    this.updateGridModel();
    let type = {
      module: 'http://localhost:4201/drafts/garden-design',
      name: 'GardenItem',
    };
    this.liveQuery = getLiveCards(
      {
        filter: {
          type,
        },
        sort: [
          {
            on: {
              ...type,
            },
            by: 'symbol',
          },
        ],
      },
      this.args.model[realmURL] ? [this.args.model[realmURL].href] : undefined,
      async (ready: Promise<void> | undefined) => {
        if (this.args.context?.actions) {
          this.args.context.actions.doWithStableScroll(
            this.args.model as CardDef,
            async () => {
              await ready;
            },
          );
        }
      },
    );
  }

  get options() {
    if (!this.liveQuery) {
      return;
    }

    return this.liveQuery.instances;
  }

  get title() {
    return this.args.model.title ?? 'Untitled Garden';
  }

  generateGridIds = () => {
    let ids: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        ids.push(this.composeId(row, col));
      }
    }
    return ids;
  };

  composeId(x: number, y: number) {
    return `r${x}-c${y}`;
  }

  decomposeId(id: string): { x: number; y: number } {
    let arr = id.replace('r', '').replace('c', '').split('-');
    if (!arr[0] || !arr[1]) {
      throw new Error('Unknown id format');
    }

    return {
      x: Number(arr[0]),
      y: Number(arr[1]),
    };
  }

  get _gridModel() {
    return this.args.model.items ?? [];
  }

  updateGridModel() {
    let newValues = [...this.gridMap.entries()]
      .filter((el) => el[1] != null)
      .map((el) => {
        let position = new Position(this.decomposeId(el[0]));
        let positionedGardenItem = new PositionedCard({
          position,
          card: el[1],
        });
        return positionedGardenItem;
      });
    if (JSON.stringify(this.args.model.items) === JSON.stringify(newValues)) {
      return;
    }
    this.args.model.items = newValues;
  }

  get gridItems() {
    let items: { id: string; content: GardenItem | null }[] = [];
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

    let optionsMap = this.options
      ? new Map(
          this.options.map((opt) => [(opt as GardenItem).gardenItemId, opt]),
        )
      : new Map();
    if (dragItemId) {
      dragItem = optionsMap.get(dragItemId);
      // in dragStartFromGrid, dragItemId is set to the grid location id
      maybeCurrentValue = this.gridMap.get(dragItemId);
    }
    if (optionsMap.has(dropTargetId)) {
      // if the drop target has content, we need to get its grid location id
      dropTargetId = (ev.target as HTMLElement)?.parentElement?.id;
    }
    if (!dropTargetId || !this.gridMap.has(dropTargetId)) {
      if (maybeCurrentValue && dragItemId) {
        // item from the grid is dragged to unknown location, remove it from the grid
        this.gridMap.set(dragItemId, null);
      } else {
        return;
      }
    } else if (maybeCurrentValue && dragItemId) {
      // move item from one grid location to another
      this.gridMap.set(dragItemId, null);
      this.gridMap.set(dropTargetId, maybeCurrentValue);
    } else if (dragItem) {
      this.gridMap.set(dropTargetId, dragItem);
    }
    this.updateGridModel();
  }

  @action reset() {
    [...this.gridMap.keys()].map((key) => this.gridMap.set(key, null));
    this.updateGridModel();
  }
}

export class GardenItem extends CardDef {
  @field gardenItemId = contains(StringField);
  @field name = contains(StringField);
  @field symbol = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: GardenItem) {
      return this.gardenItemId;
    },
  });

  static displayName = 'Garden Item';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span>
        <@fields.symbol />
      </span>
    </template>
  };
}

export class GardenDesign extends CardDef {
  @field rows = contains(NumberField);
  @field columns = contains(NumberField);
  @field items = containsMany(PositionedCard);
  static displayName = 'Garden Design';
  static isolated = Isolated;
}
