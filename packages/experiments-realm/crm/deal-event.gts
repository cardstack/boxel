import { contains, field } from 'https://cardstack.com/base/card-api';
import { Event } from '../event';
import { Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import { FieldContainer, BoxelSelect } from '@cardstack/boxel-ui/components';
import CalendarPlus from '@cardstack/boxel-icons/calendar-plus';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import Info from '@cardstack/boxel-icons/info';
import EntityDisplayWithIcon from '../components/entity-icon-display';

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

class Atom extends Component<typeof DealEvent> {
  <template>
    <div class='event-summary'>
      {{#if @model.eventDate}}
        <EntityDisplayWithIcon>
          <:icon>
            <Info width='16px' height='16px' class='event-info-icon' />
          </:icon>
          <:title><label>Event Date</label></:title>
          <:content>
            <span class='event-item-value'><@fields.eventDate /></span>
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}

      {{#if @model.attendees}}
        <EntityDisplayWithIcon>
          <:title><label>Attendees</label></:title>
          <:content>
            <span class='event-item-value'><@fields.attendees /></span>
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}

      {{#if @model.location}}
        <EntityDisplayWithIcon>
          <:title><label>Venue</label></:title>
          <:content>
            <span class='event-item-value'><@fields.location /></span>
          </:content>
        </EntityDisplayWithIcon>
      {{/if}}
    </div>
    <style scoped>
      .event-summary {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xl);
        padding: var(--boxel-sp);
        background-color: var(--boxel-200);
        border-radius: var(--boxel-form-control-border-radius);
      }
      label {
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: #777;
      }
      .event-item-value {
        font-size: var(--boxel-font-size);
        font-weight: 600;
        color: var(--boxel-dark);
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

export class DealEvent extends Event {
  static displayName = 'Deal Event';
  static icon = CalendarPlus;

  @field attendees = contains(NumberField);

  @field title = contains(StringField, {
    computeVia(this: DealEvent) {
      return `${this.eventType} at ${this.location} (${this.startDateTime})`;
    },
  });

  @field eventDate = contains(StringField, {
    computeVia(this: DealEvent) {
      const date = new Date(this.startDateTime);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    },
  });

  static atom = AtomTemplate;
  static isolated = IsolatedTemplate;
  static edit = EditTemplate;
}
