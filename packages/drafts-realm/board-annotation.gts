import {
  FieldDef,
  field,
  contains,
  primitive,
} from 'https://cardstack.com/base/card-api';
import { concat, fn } from '@ember/helper';
import { Component } from 'https://cardstack.com/base/card-api';
import { RadioInput } from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';
import NumberField from 'https://cardstack.com/base/number';
import StringField from 'https://cardstack.com/base/string';

let groupNumber = 0;
class BodyBalance extends FieldDef {
  static displayName = 'Body Balance';
  static [primitive]:
    | '0/10'
    | '1/9'
    | '2/8'
    | '3/7'
    | '4/6'
    | '5/5'
    | '6/4'
    | '7/3'
    | '8/2'
    | '9/1'
    | '10/0';

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
          @groupDescription='Body Balance'
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

    private radioGroup = `__boxel_body_balance${groupNumber++}__`;

    private items = [
      { id: '0/10', text: '0/10' },
      { id: '1/9', text: '1/9' },
      { id: '2/8', text: '2/8' },
      { id: '3/7', text: '3/7' },
      { id: '4/6', text: '4/6' },
      { id: '5/5', text: '5/5' },
      { id: '6/4', text: '6/4' },
      { id: '7/3', text: '7/3' },
      { id: '8/2', text: '8/2' },
      { id: '9/1', text: '9/1' },
      { id: '10/0', text: '10/0' },
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

export class BoardAnnotation extends FieldDef {
  static displayName = 'Board Annotation';
  @field step = contains(NumberField);
  @field comment = contains(StringField);
  @field bodyPositionDegrees = contains(NumberField);
  @field bodyBalance = contains(BodyBalance);

  static embedded = class Embedded extends Component<typeof this> {
    get hasBodyBalance() {
      return this.args.model.bodyBalance != null;
    }
    get hasBodyPosition() {
      return this.args.model.bodyPositionDegrees != null;
    }
    get hasBoard() {
      return this.hasBodyPosition || this.hasBodyBalance;
    }
    get balanceToe() {
      return this.args.model.bodyBalance
        ? this.args.model.bodyBalance.split('/').shift()!
        : 5;
    }
    get balanceHeel() {
      return this.args.model.bodyBalance
        ? this.args.model.bodyBalance.split('/').pop()!
        : 5;
    }
    get positionDegrees() {
      return this.args.model.bodyPositionDegrees ?? 0;
    }
    get positionStyle() {
      return `transform: rotate(${-1 * this.positionDegrees}deg)`;
    }
    <template>
      {{#if this.hasBoard}}
        <div class='board'>
          {{#if this.hasBodyBalance}}
            <div class='body-balance'>
              <div
                class='balance {{concat "balance-" this.balanceToe}}'
              >{{this.balanceToe}}</div>
              <div
                class='balance {{concat "balance-" this.balanceHeel}}'
              >{{this.balanceHeel}}</div>
            </div>
          {{/if}}
          {{#if this.hasBodyPosition}}
            <div
              class='body-position'
              style='{{this.positionStyle}}'
            >{{this.positionDegrees}}°
              <div class='arrow'></div>
            </div>
          {{/if}}
        </div>
      {{/if}}
      {{#if @model.comment}}
        <div class='comment'>{{@model.comment}}</div>
      {{/if}}
      <style>
        .comment {
          font-size: 18px;
          font-weight: bold;
        }
        .board {
          position: absolute;
          width: 173px;
          height: 34px;
          top: calc(50% - 17px);
          border: 1px solid black;
          border-radius: 9px;
          background: rgba(0, 0, 0, 0.5);
          transform: rotate(90deg);
        }
        .board:before {
          position: absolute;
          content: '';
          top: 3px;
          left: 33px;
          width: 17px;
          height: 25px;
          border: 1px solid black;
          border-radius: 10px 10px 5px 5px;
          background: rgba(0, 0, 0, 0.5);
          transform: rotate(-27deg);
        }
        .board:after {
          position: absolute;
          content: '';
          top: 3px;
          right: 49px;
          width: 17px;
          height: 25px;
          border: 1px solid black;
          border-radius: 10px 10px 5px 5px;
          background: rgba(0, 0, 0, 0.5);
          transform: rotate(-39deg);
        }
        .body-position {
          /*
          set the style to transform: rotate(-Xdeg); based on the body position value
          */
          position: absolute;
          top: -40px;
          left: 50%;
          font-weight: bold;
          font-size: 23px;
        }
        .body-balance {
          display: flex;
          font-weight: bold;
          color: white;
          font-size: 23px;
          flex-direction: row-reverse;
          clip-path: inset(0 0 0 0 round 9px);
        }
        .balance {
          flex: 1;
          padding-left: 45px;
          text-align: center;
        }
        .balance-0 {
          background: rgba(0, 0, 0, 0);
        }
        .balance-1 {
          background: rgba(0, 0, 0, 0.1);
        }
        .balance-2 {
          background: rgba(0, 0, 0, 0.2);
        }
        .balance-3 {
          background: rgba(0, 0, 0, 0.3);
        }
        .balance-4 {
          background: rgba(0, 0, 0, 0.4);
        }
        .balance-5 {
          background: rgba(0, 0, 0, 0.5);
        }
        .balance-6 {
          background: rgba(0, 0, 0, 0.6);
        }
        .balance-7 {
          background: rgba(0, 0, 0, 0.7);
        }
        .balance-8 {
          background: rgba(0, 0, 0, 0.8);
        }
        .balance-9 {
          background: rgba(0, 0, 0, 0.9);
        }
        .balance-10 {
          background: rgba(0, 0, 0, 1);
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
  };

  /*
  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }






































  */
}
