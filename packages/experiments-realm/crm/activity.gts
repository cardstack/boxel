import {
  CardDef,
  contains,
  linksTo,
  StringField,
  field,
  Component,
  linksToMany,
  FieldDef,
} from 'https://cardstack.com/base/card-api';
import { LooseGooseyField } from '../loosey-goosey';
import DatetimeField from 'https://cardstack.com/base/datetime';
import { Account } from './account';
import { Representative } from './representative';
import { Deal } from './deal';
import { Contact } from './contact';
import EntityDisplayWithIcon from '../components/entity-icon-display';
import EntityDisplayWithThumbnail from '../components/entity-thumbnail-display';
import Phone from '@cardstack/boxel-icons/phone';
import Mail from '@cardstack/boxel-icons/mail';
import DeviceTvOld from '@cardstack/boxel-icons/device-tv-old';
import CalendarIcon from '@cardstack/boxel-icons/calendar';
import Clock24 from '@cardstack/boxel-icons/clock-24';
import ClockCheck from '@cardstack/boxel-icons/clock-check';
import AlarmClockOff from '@cardstack/boxel-icons/alarm-clock-off';
import SquareUser from '@cardstack/boxel-icons/square-user';
import UsersRound from '@cardstack/boxel-icons/users-round';
import ActivityCard from '../components/activity-card';
import { Pill, Avatar } from '@cardstack/boxel-ui/components';
import { htmlSafe } from '@ember/template';
import { concat } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { FieldContainer, BoxelSelect } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { Call } from './activity-type/call';
import { Email } from './activity-type/email';
import { Meeting } from './activity-type/meeting';
import type IconComponent from '@cardstack/boxel-icons/captions';

// Helper function to create a clean instance with all nested properties reset
export const createCleanInstance = <T extends Call | Email | Meeting>(
  Constructor: new () => T,
) => {
  const instance = new Constructor();
  const clearObject = (obj: any) => {
    for (const key in obj) {
      if (typeof obj[key] === 'object' && obj[key] !== null) {
        clearObject(obj[key]);
      } else {
        obj[key] = null;
      }
    }
  };
  clearObject(instance);
  return instance;
};

export interface ActivityValueSignature {
  index: number;
  label: string;
  icon?: typeof IconComponent;
}

export const activityValues = [
  {
    index: 0,
    icon: Phone,
    label: 'Customer Call',
  },
  {
    index: 1,
    icon: Mail,
    label: 'Email',
  },
  {
    index: 2,
    icon: DeviceTvOld,
    label: 'Meeting',
  },
] as ActivityValueSignature[];

class EditActivityTemplate extends Component<typeof ActivityField> {
  @tracked activity: ActivityValueSignature | null =
    activityValues.find((type) => type.label === this.args.model.type) ?? null;

  @action onSelectActivity(type: ActivityValueSignature) {
    this.activity = type;
    this.args.model.type = type.label;

    // Create fresh instances with all nested data reset
    const freshCall = createCleanInstance(Call);
    const freshEmail = createCleanInstance(Email);
    const freshMeeting = createCleanInstance(Meeting);

    switch (type.label) {
      case 'Customer Call':
        this.args.model.email = freshEmail;
        this.args.model.meeting = freshMeeting;
        break;
      case 'Email':
        this.args.model.call = freshCall;
        this.args.model.meeting = freshMeeting;
        break;
      case 'Meeting':
        this.args.model.call = freshCall;
        this.args.model.email = freshEmail;
        break;
    }
  }

  <template>
    <div class='activity-edit-form'>
      <BoxelSelect
        @placeholder={{'Select Activity Type'}}
        @options={{activityValues}}
        @selected={{this.activity}}
        @onChange={{this.onSelectActivity}}
        @searchEnabled={{true}}
        @searchField='label'
        as |activity|
      >
        {{activity.label}}
      </BoxelSelect>

      {{#if this.activity}}
        <FieldContainer @vertical={{true}} class='activity-details'>
          {{#if (eq this.activity.label 'Customer Call')}}
            <@fields.call @format='edit' />
          {{else if (eq this.activity.label 'Email')}}
            <@fields.email @format='edit' />
          {{else if (eq this.activity.label 'Meeting')}}
            <@fields.meeting @format='edit' />
          {{/if}}
        </FieldContainer>
      {{/if}}
    </div>
    <style scoped>
      .activity-edit-form {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
      }
      .activity-details {
        background-color: var(--boxel-100);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp);
      }
    </style>
  </template>
}

export class ActivityField extends FieldDef {
  static displayName = 'CRM Activity Field';
  static values = activityValues;

  @field type = contains(StringField);

  @field call = contains(Call);
  @field email = contains(Email);
  @field meeting = contains(Meeting);

  static edit = EditActivityTemplate;
}

export const activityStatusValues = [
  {
    index: 0,
    icon: Clock24,
    label: 'Pending',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#FFF3E0',
    },
  },
  {
    index: 1,
    icon: ClockCheck,
    label: 'Completed',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#E8F5E9',
    },
  },
  {
    index: 2,
    icon: AlarmClockOff,
    label: 'Cancelled',
    colorScheme: {
      foregroundColor: '#000000',
      backgroundColor: '#FFEBEE',
    },
  },
];

class ActivityStatus extends LooseGooseyField {
  static displayName = 'CRM Activity Status';
  static values = activityStatusValues;

  static atom = class Atom extends Component<typeof this> {
    get statusData() {
      return activityStatusValues.find(
        (status) => status.label === this.args.model.label,
      );
    }

    <template>
      {{#if @model.label}}
        <EntityDisplayWithIcon @title={{@model.label}}>
          <:icon>
            {{this.statusData.icon}}
          </:icon>
        </EntityDisplayWithIcon>
      {{/if}}
    </template>
  };
}

class EmbeddedTemplate extends Component<typeof Activity> {
  get activity() {
    return this.args.model.activity;
  }

  get activityType() {
    return this.activity?.type;
  }

  get activityTypeIcon() {
    return activityValues.find((type) => type.label === this.activityType)
      ?.icon;
  }

  get activitySubject() {
    return this.args.model.subject;
  }

  get activityStatus() {
    return this.args.model.status;
  }

  get activityDueDate() {
    if (!this.args.model.dueDate) return null;
    return new Date(this.args.model.dueDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  get activityDueTime() {
    if (!this.args.model.dueDate) return null;
    return new Date(this.args.model.dueDate).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  get activityContacts() {
    return this.args.model.contact;
  }

  get activityRep() {
    return this.args.model.rep;
  }

  get activityRepName() {
    return `Rep: ${this.activityRep?.name ?? '-'}`;
  }

  get contactIcon() {
    if (!this.activityContacts) return null;
    return this.activityContacts?.length > 1 ? UsersRound : SquareUser;
  }

  get hasMultipleContacts() {
    return Boolean(this.activityContacts && this.activityContacts.length > 1);
  }

  get displayExternalInternalContacts() {
    if (!this.activityContacts?.length) return '';

    const externalContacts = this.activityContacts.filter(
      (contact) =>
        !contact.company ||
        contact.company.name !== this.args.model.account?.company?.name,
    );
    const internalContacts = this.activityContacts.filter(
      (contact) =>
        contact.company &&
        contact.company.name === this.args.model.account?.company?.name,
    );

    return `${externalContacts.length} External, ${internalContacts.length} Internal`;
  }

  get contactNames() {
    return (
      this.activityContacts?.map((contact) => contact.name).join(', ') ?? ''
    );
  }

  <template>
    <ActivityCard>
      <:header>
        <header aria-label='Activity details'>
          <div class='activity-card-subject-group'>
            <EntityDisplayWithIcon @title={{this.activityType}}>
              <:icon>
                {{this.activityTypeIcon}}
              </:icon>
            </EntityDisplayWithIcon>
            <p class='activity-card-subject'>{{this.activitySubject}}</p>
          </div>

          <aside class='activity-card-status' aria-label='Activity status'>
            {{#if this.activityStatus}}
              <Pill
                style={{htmlSafe
                  (concat
                    'background-color: '
                    @model.status.colorScheme.backgroundColor
                    '; border-color: transparent; font-weight: 600; font-size: 11px;'
                  )
                }}
              >{{@model.status.label}}</Pill>
            {{/if}}
          </aside>
        </header>
      </:header>

      <:content>
        <div class='activity-card-content'>
          <div class='activity-card-content-left'>
            {{#if this.activityContacts}}
              {{#if this.hasMultipleContacts}}
                <EntityDisplayWithIcon
                  @title={{this.displayExternalInternalContacts}}
                >
                  <:icon>
                    <UsersRound />
                  </:icon>
                  <:content>
                    <span>{{this.contactNames}}</span>
                  </:content>
                </EntityDisplayWithIcon>
              {{else}}
                {{#each this.activityContacts as |contact|}}
                  <EntityDisplayWithIcon @title={{contact.name}}>
                    <:icon>
                      <SquareUser />
                    </:icon>
                    <:content>
                      <span>{{contact.company.name}}</span>
                    </:content>
                  </EntityDisplayWithIcon>
                {{/each}}
              {{/if}}
            {{/if}}

            {{#if this.activityRep}}
              <EntityDisplayWithThumbnail @title={{this.activityRepName}}>
                <:thumbnail>
                  <Avatar
                    @userID={{this.activityRep.id}}
                    @displayName={{this.activityRep.name}}
                    @thumbnailURL={{this.activityRep.thumbnailURL}}
                    @isReady={{true}}
                    class='avatar'
                  />
                </:thumbnail>
                <:content>
                  <span>
                    {{this.activityRep.position}}
                  </span>
                </:content>
              </EntityDisplayWithThumbnail>
            {{/if}}
          </div>

          <aside class='activity-card-content-right'>
            {{#if this.activityDueDate}}
              <EntityDisplayWithIcon @title={{this.activityDueDate}}>
                <:icon>
                  <CalendarIcon class='icon' />
                </:icon>
                <:content>
                  <span>{{this.activityDueTime}}</span>
                </:content>
              </EntityDisplayWithIcon>
            {{/if}}
          </aside>

        </div>
      </:content>
    </ActivityCard>

    <style scoped>
      header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: var(--activity-card-header-gap, var(--boxel-sp));
      }
      .activity-card-subject-group {
        --entity-display-icon-size: var(--boxel-icon-xs);
        --entity-display-title-font-size: var(--boxel-font-size-sm);
        --entity-display-title-font-weight: 600;
        display: inline-flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--activity-card-subject-group-gap, var(--boxel-sp-sm));
      }
      .activity-card-subject {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        color: var(--boxel-500);
      }
      .activity-card-content {
        container-type: inline-size;
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--activity-card-content-gap, var(--boxel-sp));
      }
      .activity-card-content-left {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(200px, max-content));
        gap: var(--activity-card-content-left-gap, var(--boxel-sp));
      }
      .activity-card-content .avatar {
        --profile-avatar-icon-size: 20px;
        --profile-avatar-icon-border: 0px;
        flex-shrink: 0;
      }
      .activity-card-content-right {
        margin-left: 0;
      }

      @container (min-width: 400px) {
        .activity-card-content {
          grid-template-columns: 3fr 1fr;
        }
        .activity-card-content-right {
          margin-left: auto;
        }
      }
    </style>
  </template>
}

export class Activity extends CardDef {
  static displayName = 'CRM Activity';
  @field subject = contains(StringField);
  @field activity = contains(ActivityField);
  @field status = contains(ActivityStatus);
  @field contact = linksToMany(() => Contact); // Each activity has connected with contact / contacts
  @field deal = linksTo(() => Deal);
  @field account = linksTo(() => Account);
  @field dueDate = contains(DatetimeField);
  @field rep = linksTo(() => Representative);
  @field title = contains(StringField, {
    computeVia: function (this: Activity) {
      return this.subject;
    },
  });

  static embedded = EmbeddedTemplate;
}
