import NumberField from 'https://cardstack.com/base/number';
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';

class Isolated extends Component<typeof GardenDesign> {
  <template>
    <div class='grid' style={{this.grid}}>
      {{#each this.items as |item|}}
        <div
          class='item'
          id={{item.id}}
          {{on 'dragover' this.dragover}}
          {{on 'drop' this.dropItem}}
        />
      {{/each}}
    </div>
    <ol>
      <li>
        <span
          {{on 'dragstart' this.dragStart}}
          id='purple-coneflower'
          draggable='true'
          class='plant purple-coneflower'
        >1</span>
        Purple Coneflower
      </li>
      <li>
        <span
          {{on 'dragstart' this.dragStart}}
          id='black-eyed-susan'
          draggable='true'
          class='plant black-eyed-susan'
        >2</span>
        Black-Eyed Susan
      </li>
      <li>
        <span
          {{on 'dragstart' this.dragStart}}
          id='lavender-hyssop'
          draggable='true'
          class='plant lavender-hyssop'
        >3</span>
        Lavender Hyssop
      </li>
    </ol>
    <style>
      .grid {
        margin: 20px auto;
        width: max-content;
        border: 2px solid green;
        display: grid;
      }
      .item {
        border: 1px solid black;
        display: flex;
        justify-content: center;
        align-items: center;
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
      .purple-coneflower {
        background-color: #fb9cbf;
        border-color: #ea5c79;
        color: #a93110;
      }
      .black-eyed-susan {
        background-color: palegoldenrod;
        border-color: goldenrod;
        color: darkgoldenrod;
      }
      .lavender-hyssop {
        background-color: lavender;
        border-color: purple;
        color: darkpurple;
      }
    </style>
  </template>

  defaultUnit = 30;
  defaultSize = 10;
  @tracked grid;
  @tracked items;

  constructor(owner, args) {
    super(owner, args);
    this.args.model.width = this.args.model.width ?? this.defaultSize;
    this.args.model.length = this.args.model.length ?? this.defaultSize;
    this.args.model.unitPx = this.args.model.unitPx ?? this.defaultUnit;
    this.grid = this.generateGrid();
    this.items = this.generateGridItems();
  }

  generateGrid = () => {
    return htmlSafe(`
      grid-template-columns: repeat(${this.args.model.width}, ${this.args.model.unitPx}px);
      grid-template-rows: repeat(${this.args.model.length}, ${this.args.model.unitPx}px);
    `);
  };

  generateGridItems = () => {
    let items = [];
    for (let j = 0; j < this.args.model.length; j++) {
      for (let i = 0; i < this.args.model.width; i++) {
        items.push({
          id: `target-${i}-${j}`,
        });
      }
    }
    return items;
  };

  @action dragStart(ev) {
    ev.dataTransfer.setData('text/plain', ev.target.id);
    ev.dataTransfer.dropEffect = 'move';
  }

  @action dragover(ev) {
    ev.preventDefault();
  }

  @action dropItem(ev) {
    ev.preventDefault();
    let id = ev.dataTransfer.getData('text/plain');
    let itemCopy = document.getElementById(id).cloneNode(true);
    itemCopy.draggable = false;
    ev.target.appendChild(itemCopy);
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
