import { Person as PersonCard } from './person';
import StringCard from 'https://cardstack.com/base/string';
import { array, fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';

import {
  Component,
  field,
  contains,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import TextAreaCard from '../base/text-area';
import BooleanField from '../base/boolean';
import DateField from '../base/date';
import TimeCard from '../base/time';
import {
  BoxelDropdown,
  FieldContainer,
  Menu,
} from '@cardstack/boxel-ui/components';

import { menuItem } from '@cardstack/boxel-ui/helpers';

class Edit extends Component<typeof Event> {
  @tracked eventType = this.args.model.eventType;

  @action updateEventType(type: string) {
    this.eventType = type;
    this.args.model.eventType = type;
  }

  <template>
    <div class='row'>
      <FieldContainer @label='Subject' @tag='label' class='field column'>
        <@fields.subject />
      </FieldContainer>
      <FieldContainer @label='Assigned to' @tag='label' class='field column'>
        <@fields.assignee />
      </FieldContainer>
    </div>
    <div class='row'>
      <FieldContainer @label='Location' @tag='label' class='field column'>
        <@fields.location />
      </FieldContainer>
      <div class='column' />
    </div>
    <div class='row'>
      <FieldContainer @label='Start' @tag='label' class='field column'>
        <div class='inner-row'>
          <@fields.startDate />
          <div class='divider' />
          <@fields.startTime />
        </div>
      </FieldContainer>
      <div class='column' />
    </div>
    <div class='row'>
      <FieldContainer @label='End' @tag='label' class='field column'>
        <div class='inner-row'>
          <@fields.endDate />
          <div class='divider' />
          <@fields.endTime />
        </div>
      </FieldContainer>
      <div class='column' />
    </div>
    <div class='row'>
      <FieldContainer @label='Event type' @tag='label' class='field column'>
        <BoxelDropdown @contentClass='context-menu'>
          <:trigger as |bindings|>
            <button
              class='event-type-input'
              {{bindings}}
              data-test-realm-filter-button
            >
              {{this.eventType}}
            </button>
          </:trigger>
          <:content as |dd|>
            <Menu
              class='context-menu-list'
              @items={{array
                (menuItem 'Email' (fn this.updateEventType 'Email'))
                (menuItem 'Meeting' (fn this.updateEventType 'Meeting'))
                (menuItem 'Call' (fn this.updateEventType 'Call'))
                (menuItem 'Other' (fn this.updateEventType 'Other'))
                (menuItem 'None' (fn this.updateEventType 'None'))
              }}
              @closeMenu={{dd.close}}
            />
          </:content>
        </BoxelDropdown>

      </FieldContainer>
      <div class='column' />
    </div>
    <div class='row'>
      <FieldContainer @label='Description' @tag='label' class='field column'>
        <@fields.description />
      </FieldContainer>
      <div class='column' />
    </div>
    <div class='row'>
      <FieldContainer
        @label='Is reminder set'
        @tag='label'
        class='field column'
      >
        <@fields.isReminderSet />
      </FieldContainer>
      <div class='column' />
    </div>
    <style>
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
      .divider {
        width: 20px;
      }
      .column {
        width: 50%;
      }
      .event-type-input {
        text-align: left;
        height: var(--boxel-form-control-height);
        border-radius: var(--boxel-form-control-border-radius);
        transition: border-color var(--boxel-transition);
        border: 1px solid var(--boxel-form-control-border-color);
        padding: var(--boxel-sp-xs) 0 var(--boxel-sp-xs) var(--boxel-sp-sm);
        background-color: white;
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
            <@fields.startDate />
            <div class='divider' />
            <@fields.startTime />
          </div>
        </FieldContainer>
        <FieldContainer @label='End' @tag='label' class='field'>
          <div class='inner-row'>
            <@fields.endDate />
            <div class='divider' />
            <@fields.endTime />
          </div>
        </FieldContainer>
        <FieldContainer @label='Event type' @tag='label' class='field'>
          <@fields.description />
        </FieldContainer>
        <FieldContainer @label='Description' @tag='label' class='field'>
          <@fields.description />
        </FieldContainer>
        <FieldContainer
          @label='Is reminder set'
          @tag='label'
          class='field column'
        >
          <@fields.isReminderSet />
        </FieldContainer>
      </div>
      <div class='column'>
        <FieldContainer @label='Assigned to' @tag='label' class='field'>
          <@fields.assignee />
        </FieldContainer>
      </div>
    </div>
    <div class='row'>
      <FieldContainer @label='Location' @tag='label' class='field'>
        <@fields.location />
      </FieldContainer>
      <div class='column' />
    </div>
    <style>
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
      .divider {
        width: 20px;
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
  @field startDate = contains(DateField);
  @field endDate = contains(DateField);
  @field startTime = contains(TimeCard);
  @field endTime = contains(TimeCard);
  @field eventType = contains(StringCard);
  @field description = contains(TextAreaCard);
  @field isReminderSet = contains(BooleanField);

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
