/*
 * Feedback from this champagne drinking exercise:
 *
 * - It would be nice to have a range input slider boxel ui component
 *
 * - I would like to be able to pass non-persisted application state between
 *   cards/fields. in this case the "stance" state represents a way to view
 *   the diagram that does not make sense to persist. This state effects both
 *   the diagram and the annotations on the diagram. I had to use a global to
 *   pass this state between card and field, ew!
 *
 * - I would like to be able to view and edit a card in the same view. it is a
 *   real pain to have to switch between edit format and isoalted format. making
 *   these modal was a UX choice. instead it would be much nicer to splay the card's
 *   formats on teh page simultaneously so that I could view both the edit and the
 *   isolated (and probably other formats simulanteously. For now I had to use the
 *   monaco editor to get that type of view which was not ideal for card data entry.
 *
 * - I ran into a bug where updated fields in a composite containsMany are not
 *   auto-saved. bug filed: CS-6862.
 *
 * - I was unable to live edit the CSS in chrome for the field in the card. oddly I
 *   could live edit the CSS in chrome for the card itself, but not its fields. that
 *   made CSS authoring rather painful. Perhaps this has something to do with the way
 *   our scoped CSS works?
 *
 * - When using VS Code to author code (it was too painful to use monaco because of
 *   the auto-saving during bad syntax), it was annoying that re-indexing wasn't
 *   triggered after the card definition file change. I suspect that if I was
 *   viewing the card deifnition in monaco it live updates (i didn't happen to have
 *   card definition open in monaco at the time). but instances that consume the card
 *   definition are not live updated when the gts file changes on disk. I think this
 *   is either an oversigh or perhaps a bug. Not sure that it is that important, though,
 *   as generally people will not be using VS code to directly edit cards in a local
 *   boxel instance (I assume).
 */

import {
  CardDef,
  FieldDef,
  primitive,
  deserialize,
  BaseDefConstructor,
  BaseInstanceType,
  contains,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import type Owner from '@ember/owner';
import { fn, concat, get } from '@ember/helper';
import { not } from '@cardstack/boxel-ui/helpers';
import { BoardAnnotation } from './board-annotation';

// this allows multiple radio groups rendered on the page
// to stay independent of one another.
let groupNumber = 0;
class DiagramType extends FieldDef {
  static displayName = 'Carving Turn Diagram Type';
  static [primitive]: 'heel' | 'toe' | 'toe/heel';

  static async [deserialize]<T extends BaseDefConstructor>(
    this: T,
    val: any,
  ): Promise<BaseInstanceType<T>> {
    if (val === undefined || val === null) {
      return 'toe/heel' as BaseInstanceType<T>;
    }
    return val as BaseInstanceType<T>;
  }
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <div class='radio-group' data-test-radio-group={{@fieldName}}>
        <RadioInput
          @items={{this.items}}
          @groupDescription='Carving Turn Diagram Type'
          name='{{this.radioGroup}}'
          @checkedId={{this.checkedId}}
          @hideBorder={{true}}
          @disabled={{not @canEdit}}
          as |item|
        >
          <item.component @onChange={{fn @set item.data.id}}>
            {{item.data.text}}
          </item.component>
        </RadioInput>
      </div>
      <style></style>
    </template>

    private radioGroup = `__boxel_carving_turn_diagram_type${groupNumber++}__`;

    private items = [
      { id: 'toe/heel', text: 'Toe and Heel Turns' },
      { id: 'toe', text: 'Toe Turn' },
      { id: 'heel', text: 'Heel Turn' },
    ];

    get checkedId() {
      return this.args.model;
    }
  };
  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model}}
    </template>
  };
}

class IsolatedView extends Component<typeof CarvingTurnDiagram> {
  @tracked stance: 'regular' | 'goofy' = 'regular';

  // A desired feature would be to share non-persisted application state
  // with other cards, maybe like setting arguments in child cards. Because
  // that is not a thing, I'm using globalThis to share the stance with child
  // fields
  constructor(owner: Owner, args: any) {
    super(owner, args);
    (globalThis as any).__carvingDiagram = this;
  }

  get showToeTurn() {
    return (
      this.args.model.diagramType === 'toe/heel' ||
      this.args.model.diagramType === 'toe'
    );
  }
  get showHeelTurn() {
    return (
      this.args.model.diagramType === 'toe/heel' ||
      this.args.model.diagramType === 'heel'
    );
  }

  get toeAnnotationFields() {
    return this.stance === 'regular'
      ? this.args.fields.toeAnnotations
      : this.args.fields.heelAnnotations;
  }

  get toeAnnotationModels() {
    return this.stance === 'regular'
      ? this.args.model.toeAnnotations
      : this.args.model.heelAnnotations;
  }

  get heelAnnotationFields() {
    return this.stance === 'regular'
      ? this.args.fields.heelAnnotations
      : this.args.fields.toeAnnotations;
  }

  get heelAnnotationModels() {
    return this.stance === 'regular'
      ? this.args.model.heelAnnotations
      : this.args.model.toeAnnotations;
  }

  private setStance = (stance: 'regular' | 'goofy') => {
    this.stance = stance;
  };

  private stanceItems = [
    { id: 'regular', text: 'Regular' },
    { id: 'goofy', text: 'Goofy' },
  ];

  <template>
    <div class='title'><@fields.title /></div>
    <div class='description'><@fields.description /></div>
    <div class='stance-switch'>
      <RadioInput
        @items={{this.stanceItems}}
        @groupDescription='Stance'
        name='stance'
        @checkedId={{this.stance}}
        as |item|
      >
        <item.component @onChange={{fn this.setStance item.data.id}}>
          {{item.data.text}}
        </item.component>
      </RadioInput>
    </div>
    <div class='container {{this.stance}}'>
      <div class='fall-line'>Fall Line
        <div class='arrow'></div>
      </div>
      {{#if this.showToeTurn}}
        <div class='toe turn'>
          {{#if this.toeAnnotationFields}}
            {{#each this.toeAnnotationFields as |annotation i|}}
              {{#let
                (get (get this.toeAnnotationModels i) 'position')
                as |position|
              }}
                <div class='position {{concat "position-" position}}'>
                  <div class='annotation'>position {{position}}</div>
                  <annotation />
                </div>
              {{/let}}
            {{/each}}
          {{/if}}
        </div>
      {{/if}}
      {{#if this.showHeelTurn}}
        <div class='heel turn'>
          {{#if this.heelAnnotationFields}}
            {{#each this.heelAnnotationFields as |annotation i|}}
              {{#let
                (get (get this.heelAnnotationModels i) 'position')
                as |position|
              }}
                <div class='position {{concat "position-" position}}'>
                  <div class='annotation'>position {{position}}</div>
                  <annotation />
                </div>
              {{/let}}
            {{/each}}
          {{/if}}
        </div>
      {{/if}}
    </div>

    <style>
      .title {
        width: 500px;
        margin: 2rem 2rem 0;
        font-weight: bold;
        font-size: 25px;
      }
      .stance-switch {
        display: flex;
        justify-content: center;
      }
      .description {
        margin: 1rem 2rem 0;
      }
      .container {
        position: relative;
        margin-top: 250px;
        margin-bottom: 200px;
      }
      .goofy :deep(.board:before) {
        transform: rotate(207deg);
      }
      .goofy :deep(.board:after) {
        transform: rotate(219deg);
      }
      .goofy :deep(.body-position) {
        top: 40px;
        left: calc(50% + 40px);
      }
      .goofy .toe .position-10 :deep(.body-position .position-value),
      .goofy .heel :deep(.body-position .position-value) {
        transform: rotate(180deg);
      }
      .turn {
        position: relative;
        width: 500px;
        height: 500px;
        margin: 0 auto;
      }
      .heel {
        top: -10px;
      }
      .turn:before {
        position: absolute;
        top: 0;
        left: 0;
        color: rgba(0, 0, 0, 0.15);
        font-size: 80px;
        text-align: center;
        line-height: 300px;
        border: 10px solid gray;
        width: calc(100% - 20px);
        height: calc(100% - 20px);
        background: rgba(0, 0, 0, 0.05);
        border-radius: 50%;
      }
      .turn:after {
        position: absolute;
        top: 0;
        left: 0;
        color: rgba(0, 0, 0, 0.15);
        font-size: 80px;
        text-align: center;
        line-height: 675px;
        border: 10px solid rgba(0, 0, 0, 0);
        background: rgba(0, 0, 0, 0.05);
        width: calc(100% - 20px);
        height: calc(100% - 20px);
        border-radius: 50%;
      }
      .toe:before {
        content: 'x+';
        clip-path: inset(-100% -100% -100% 50%);
        letter-spacing: 280px;
      }
      .heel:before {
        content: '+';
        clip-path: inset(-100% 50% -100% -100%);
        letter-spacing: 200px;
      }
      .toe:after {
        content: 'x-';
        clip-path: inset(50% -100% -100% 50%);
        letter-spacing: 280px;
      }
      .heel:after {
        content: '-';
        clip-path: inset(50% 50% -100% -100%);
        letter-spacing: 200px;
      }
      .fall-line {
        position: absolute;
        top: 150px;
        left: 40%;
        font-weight: bold;
        color: rgba(0, 0, 0, 1);
        font-size: 23px;
        opacity: 0.5;
        transform: rotate(90deg);
      }
      .annotation {
        font-weight: bold;
        font-size: 13px;
        line-height: 50px;
      }
      .toe :deep(.board) {
        left: 270px;
      }
      .heel :deep(.board) {
        left: 0;
      }
      .goofy .toe .position-10 :deep(.edge-angle),
      .heel :deep(.edge-angle) {
        top: 70px;
        left: 60px;
        transform: rotate(180deg);
      }
      .position {
        position: absolute;
        height: 50px;
        width: 600px;
        opacity: 0.6;
      }
      .toe .position {
        padding-left: 270px;
      }
      .heel .position {
      }
      .toe .position-0 {
        transform: rotate(-0.25turn);
        left: -60px;
        top: -80px;
      }
      .toe .position-1 {
        transform: rotate(-0.2turn);
        left: 31px;
        top: -67px;
      }
      .toe .position-2 {
        transform: rotate(-0.15turn);
        left: 111px;
        top: -24px;
      }
      .toe .position-3 {
        transform: rotate(-0.1turn);
        left: 180px;
        top: 40px;
      }
      .toe .position-4 {
        transform: rotate(-0.05turn);
        left: 225px;
        top: 121px;
      }
      .toe .position-5 {
        top: calc(50% - 25px);
        left: 50%;
      }
      .toe .position-6 {
        transform: rotate(0.05turn);
        left: 225px;
        top: 308px;
      }
      .toe .position-7 {
        transform: rotate(0.1turn);
        left: 183px;
        top: 391px;
      }
      .toe .position-8 {
        transform: rotate(0.15turn);
        left: 115px;
        top: 455px;
      }
      .toe .position-9 {
        transform: rotate(0.2turn);
        left: 33px;
        top: 498px;
      }
      .toe .position-10 {
        transform: rotate(0.25turn);
        left: -60px;
        top: 515px;
      }

      .heel .position-0 {
        transform: rotate(0.25turn);
        right: -60px;
        top: 108px;
      }
      .heel .position-1 {
        transform: rotate(0.2turn);
        right: -29px;
        top: 112px;
      }
      .heel .position-2 {
        transform: rotate(0.15turn);
        right: 5px;
        top: 125px;
      }
      .heel .position-3 {
        transform: rotate(0.1turn);
        right: 31px;
        top: 148px;
      }
      .heel .position-4 {
        transform: rotate(0.05turn);
        right: 40px;
        top: 182px;
      }
      .heel .position-5 {
        top: calc(50% - 25px);
        right: 46px;
      }
      .heel .position-6 {
        transform: rotate(-0.05turn);
        right: 30px;
        top: 245px;
      }
      .heel .position-7 {
        transform: rotate(-0.1turn);
        right: 17px;
        top: 271px;
      }
      .heel .position-8 {
        transform: rotate(-0.15turn);
        right: -2px;
        top: 294px;
      }
      .heel .position-9 {
        transform: rotate(-0.2turn);
        right: -29px;
        top: 312px;
      }
      .heel .position-10 {
        transform: rotate(-0.25turn);
        right: -60px;
        top: 306px;
      }
      .arrow {
        font-weight: inherit;
        font-size: inherit;
        position: absolute;
        top: 15px;
        right: -45px;
        width: 35px;
        height: 5px;
        background-color: rgba(0, 0, 0, 1);
      }
      .arrow::after,
      .arrow::before {
        content: '';
        position: absolute;
        width: 20px;
        height: 5px;
        right: -8px;
        background-color: rgba(0, 0, 0, 1);
      }
      .arrow::after {
        top: -6px;
        transform: rotate(45deg);
      }
      .arrow::before {
        top: 5px;
        transform: rotate(-45deg);
      }
    </style>
  </template>
}

export class CarvingTurnDiagram extends CardDef {
  static displayName = 'Carving Turn Diagram';
  @field diagramType = contains(DiagramType, {
    description:
      'An indicator for which turns to include in the diagram: toe turn, heel turn, or both toe and heel turns.',
  });
  @field toeAnnotations = containsMany(BoardAnnotation, {
    description: 'A collection of annotations for a toe side turn',
  });
  @field heelAnnotations = containsMany(BoardAnnotation, {
    description: 'A collection of annotations for a heel side turn',
  });

  static isolated = IsolatedView;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <@fields.title />
    </template>
  };
}
