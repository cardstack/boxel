import { Person as PersonCard } from './person';
import StringCard from 'https://cardstack.com/base/string';
import DateTimeCard from 'https://cardstack.com/base/datetime';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import {
  Component,
  field,
  contains,
  CardDef,
  linksTo,
  StringField,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from '../base/text-area';
import { FieldContainer, BoxelSelect } from '@cardstack/boxel-ui/components';

class Edit extends Component<typeof Event> {
  @tracked selectedEventType = { name: this.args.model.eventType };
  @tracked eventTypeItems = [
    { name: 'Email' },
    { name: 'Meeting' },
    { name: 'Call' },
    { name: 'Other' },
    { name: 'None' },
  ];

  @action updateEventType(type: { name: string }) {
    this.selectedEventType = type;
    this.args.model.eventType = type.name;
  }

  <template>
    <div class='row'>
      <div class='column'>
        <FieldContainer @label='Subject' @tag='label' class='field'>
          <@fields.subject />
        </FieldContainer>
        <FieldContainer @label='Location' @tag='label' class='field'>
          <@fields.location />
        </FieldContainer>
        <FieldContainer @label='Start' @tag='label' class='field'>
          <@fields.startDateTime />
        </FieldContainer>
        <FieldContainer @label='End' @tag='label' class='field'>
          <@fields.endDateTime />
        </FieldContainer>
        <FieldContainer @label='Event type' @tag='label' class='field'>
          <BoxelSelect
            @placeholder={{'Select Item'}}
            @selected={{this.selectedEventType}}
            @onChange={{this.updateEventType}}
            @options={{this.eventTypeItems}}
            @dropdownClass='boxel-select-usage'
            class='select'
            as |item|
          >
            <div>{{item.name}}</div>
          </BoxelSelect>
        </FieldContainer>
        <FieldContainer @label='Description' @tag='label' class='field'>
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Title' @tag='label' class='field'>
          <@fields.title />
        </FieldContainer>
      </div>
      <div class='column'>
        <FieldContainer @label='Assigned to' @tag='label' class='field'>
          <@fields.assignee />
        </FieldContainer>
      </div>
    </div>
    <style scoped>
      .row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 0 calc(1.25rem * 1.333);
        margin-top: 20px;
      }
      .column {
        width: 50%;
      }
      .select {
        text-align: left;
        height: var(--boxel-form-control-height);
        border-radius: var(--boxel-form-control-border-radius);
        transition: border-color var(--boxel-transition);
        border: 1px solid var(--boxel-form-control-border-color);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) 0;
        background-color: white;
        display: flex;
        flex-direction: row;
        align-items: center;
      }
      .column > label {
        margin-bottom: 20px;
      }
    </style>
  </template>
}

class Isolated extends Component<typeof Event> {
  <template>
    <div class='row'>
      <div class='column'>
        <FieldContainer @label='Subject' @tag='label' class='field'>
          <@fields.subject />
        </FieldContainer>
        <FieldContainer @label='Location' @tag='label' class='field'>
          <@fields.location />
        </FieldContainer>
        <FieldContainer @label='Start' @tag='label' class='field'>
          <div class='inner-row'>
            <@fields.startDateTime />
          </div>
        </FieldContainer>
        <FieldContainer @label='End' @tag='label' class='field'>
          <div class='inner-row'>
            <@fields.endDateTime />
          </div>
        </FieldContainer>
        <FieldContainer @label='Event type' @tag='label' class='field'>
          <@fields.eventType />
        </FieldContainer>
        <FieldContainer @label='Description' @tag='label' class='field'>
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Title' @tag='label' class='field'>
          <@fields.title />
        </FieldContainer>
      </div>
      <div class='column'>
        <FieldContainer @label='Assigned to' @tag='label' class='field'>
          <@fields.assignee />
        </FieldContainer>
      </div>
    </div>
    <style scoped>
      .row {
        display: flex;
        flex-direction: row;
        justify-content: space-between;
        padding: 0 calc(1.25rem * 1.333);
        margin-top: 20px;
      }
      .inner-row {
        width: 100%;
        display: flex;
        flex-direction: row;
      }
      .column {
        width: 50%;
      }
      .column > label {
        margin-bottom: 20px;
      }
    </style>
  </template>
}

export class Event extends CardDef {
  static displayName = 'Event form';
  @field subject = contains(StringCard);
  @field location = contains(StringCard);
  @field assignee = linksTo(PersonCard);
  @field startDateTime = contains(DateTimeCard);
  @field endDateTime = contains(DateTimeCard);
  @field eventType = contains(StringCard);
  @field description = contains(TextAreaCard);
  @field title = contains(StringField, {
    computeVia(this: Event) {
      return this.subject;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      Subject: <@fields.subject />
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      Subject: <@fields.subject />
    </template>
  };

  static edit = Edit;

  static isolated = Isolated;
}
