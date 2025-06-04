import {
  contains,
  field,
  CardDef,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Representative } from './representative';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import DateTimeField from 'https://cardstack.com/base/datetime';
import TextAreaField from 'https://cardstack.com/base/text-area';
import {
  FieldContainer,
  BoxelSelect,
  EntityDisplayWithIcon,
} from '@cardstack/boxel-ui/components';
import CalendarPlus from '@cardstack/boxel-icons/calendar-plus';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Info from '@cardstack/boxel-icons/info';

class IsolatedTemplate extends Component<typeof DealEvent> {
  <template>
    <div class='deal-event-summary'>
      <FieldContainer @label='Subject'>
        <@fields.subject />
      </FieldContainer>
      <FieldContainer @label='Location'>
        <@fields.location />
      </FieldContainer>
      <FieldContainer @label='Start'>
        <div class='inner-row'>
          <@fields.startDateTime />
        </div>
      </FieldContainer>
      <FieldContainer @label='End'>
        <div class='inner-row'>
          <@fields.endDateTime />
        </div>
      </FieldContainer>
      <FieldContainer @label='Event Date'>
        <@fields.eventDate />
      </FieldContainer>
      <FieldContainer @label='Event type'>
        <@fields.eventType />
      </FieldContainer>
      <FieldContainer @label='Description'>
        <@fields.description />
      </FieldContainer>
      <FieldContainer @label='Title'>
        <@fields.title />
      </FieldContainer>
      <FieldContainer @label='Assigned to'>
        <@fields.assignee />
      </FieldContainer>
      <FieldContainer @label='Attendees'>
        <@fields.attendees />
      </FieldContainer>
    </div>
    <style scoped>
      .deal-event-summary {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
      }
    </style>
  </template>
}

class AtomTemplate extends Component<typeof DealEvent> {
  <template>
    <div class='event-summary'>
      {{#if @model.eventDate}}
        <EntityDisplayWithIcon @title='Event Date'>
          <:icon>
            <Info />
          </:icon>
          <:content>
            <@fields.eventDate />
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}

      {{#if @model.attendees}}
        <EntityDisplayWithIcon @title='Attendees'>
          <:content>
            <@fields.attendees />
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}

      {{#if @model.location}}
        <EntityDisplayWithIcon @title='Venue'>
          <:content>
            <@fields.location />
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}
    </div>
    <style scoped>
      .event-summary {
        --entity-display-icon-size: var(
          --event-summary-icon-size,
          var(--boxel-font-size)
        );
        --entity-display-title-font-size: var(
          --event-summary-title-font-size,
          var(--boxel-font-size-xs)
        );
        --entity-display-title-font-weight: var(
          --event-summary-title-font-weight,
          500
        );
        --entity-display-title-color: var(--event-summary-title-color, #777);
        --entity-display-content-font-size: var(
          --event-summary-content-font-size,
          var(--boxel-font-size)
        );
        --entity-display-content-font-weight: var(
          --event-item-value-font-weight,
          600
        );
        --entity-display-content-color: var(
          --event-summary-content-color,
          var(--boxel-dark)
        );
        display: var(--event-summary-display, inline-flex);
        flex-wrap: var(--event-summary-flex-wrap, wrap);
        gap: var(--event-summary-gap, var(--boxel-sp-xl));
        padding: var(--event-summary-padding, var(--boxel-sp));
        background-color: var(
          --event-summary-background-color,
          var(--boxel-200)
        );
        border-radius: var(
          --event-summary-border-radius,
          var(--boxel-form-control-border-radius)
        );
        width: 100%;
        overflow: hidden;
      }
    </style>
  </template>
}

class EditTemplate extends Component<typeof DealEvent> {
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
    <div class='deal-event-form'>
      <FieldContainer @label='Subject'>
        <@fields.subject />
      </FieldContainer>
      <FieldContainer @label='Location'>
        <@fields.location />
      </FieldContainer>
      <FieldContainer @label='Start'>
        <@fields.startDateTime />
      </FieldContainer>
      <FieldContainer @label='End'>
        <@fields.endDateTime />
      </FieldContainer>
      <FieldContainer @label='Event Date'>
        <@fields.eventDate />
      </FieldContainer>
      <FieldContainer @label='Event type'>
        <BoxelSelect
          @placeholder='Select Item'
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
      <FieldContainer @label='Description'>
        <@fields.description />
      </FieldContainer>
      <FieldContainer @label='Title'>
        <@fields.title />
      </FieldContainer>
      <FieldContainer @label='Attendees'>
        <@fields.attendees />
      </FieldContainer>
      <FieldContainer @label='Assigned to'>
        <@fields.assignee />
      </FieldContainer>
    </div>

    <style scoped>
      .deal-event-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp-lg);
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
    </style>
  </template>
}

// @ts-ignore
export class DealEvent extends CardDef {
  static displayName = 'Deal Event';
  static icon = CalendarPlus;

  @field attendees = contains(NumberField);
  @field subject = contains(StringField);
  @field location = contains(StringField);
  @field assignee = linksTo(() => Representative);
  @field startDateTime = contains(DateTimeField);
  @field endDateTime = contains(DateTimeField);
  @field eventType = contains(StringField);
  @field description = contains(TextAreaField);

  @field title = contains(StringField, {
    computeVia(this: DealEvent) {
      if (!this.eventType || !this.location || !this.startDateTime) {
        return '';
      }
      return `${this.eventType} at ${this.location} (${this.startDateTime})`;
    },
  });

  @field eventDate = contains(StringField, {
    computeVia(this: DealEvent) {
      if (!this.startDateTime) {
        return '';
      }
      const date = new Date(this.startDateTime);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
  });

  static isolated = IsolatedTemplate;
  static atom = AtomTemplate;
  static edit = EditTemplate;
}
