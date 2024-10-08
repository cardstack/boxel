import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
  linksToMany,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import {
  BoxelSelect,
  Avatar,
  Pill,
  RadioInput,
  ProgressBar,
} from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { fn } from '@ember/helper';
import { tracked } from '@glimmer/tracking';
import DateField from 'https://cardstack.com/base/date';
import TextAreaCard from '../../base/text-area';
import { eq, cssVar } from '@cardstack/boxel-ui/helpers';

export class StatusField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  statuses: StatusFieldData[] = []; //help with the types
}

interface StatusFieldData {
  index?: number;
  label?: string;
}

class Edit extends Component<typeof StatusField> {
  @tracked label: string | undefined = this.args.model.label;
  <template>
    <BoxelSelect
      @placeholder={{this.placeholder}}
      @options={{this.statuses}}
      @selected={{this.selectedStatus}}
      @onChange={{this.onSelectStatus}}
      as |item|
    >
      <div> {{item.label}}</div>
    </BoxelSelect>
  </template>

  get selectedStatus() {
    return this.statuses?.find((status) => {
      return status.label === this.label;
    });
  }

  get statuses() {
    return this.args.model?.statuses;
  }

  @action onSelectStatus(status: StatusFieldData): void {
    this.label = status.label;
    this.args.model.label = this.selectedStatus?.label;
    this.args.model.index = this.selectedStatus?.index;
  }

  get placeholder() {
    return 'Fill in';
  }
}

export class TaskStatusField extends StatusField {
  // loosey goosey pattern

  statuses = [
    { index: 0, label: 'Backlog' },
    {
      index: 1,
      label: 'Next Sprint',
    },
    {
      index: 2,
      label: 'Current Sprint',
    },
    {
      index: 3,
      label: 'In Progress',
    },
    {
      index: 4,
      label: 'In Review',
    },
    {
      index: 5,
      label: 'Staged',
    },
    {
      index: 6,
      label: 'Shipped',
    },
  ];

  static embedded = class Embedded extends Component<typeof TaskStatusField> {
    <template>
      {{this.args.model.label}}
    </template>
  };

  static edit = Edit;
}

class EditPriority extends Component<typeof TaskPriorityField> {
  @tracked label = this.args.model.label;

  get statuses() {
    return this.args.model?.statuses;
  }

  get selectedPriority() {
    return this.statuses?.find((status) => {
      return status.label === this.label;
    });
  }

  @action handlePriorityChange(priority: StatusFieldData): void {
    this.label = priority.label;
    this.args.model.label = this.selectedPriority?.label;
    this.args.model.index = this.selectedPriority?.index;
  }

  <template>
    <div class='priority-field'>
      <RadioInput
        @groupDescription='Select Task Priority'
        @items={{this.args.model.statuses}}
        @checkedId={{this.selectedPriority.label}}
        @orientation='horizontal'
        @spacing='default'
        @keyName='label'
        as |item|
      >
        <item.component @onChange={{fn this.handlePriorityChange item.data}}>
          {{item.data.label}}
        </item.component>
      </RadioInput>
    </div>
  </template>
}

export class TaskPriorityField extends StatusField {
  // loosey goosey pattern

  statuses = [
    { index: 0, label: 'Low' },
    {
      index: 1,
      label: 'Medium',
    },
    {
      index: 2,
      label: 'High',
    },
  ];

  static edit = EditPriority;
  static embedded = class Embedded extends Component<typeof TaskPriorityField> {
    <template>
      {{this.args.model.label}}
    </template>
  };
}

export class User extends CardDef {
  static displayName = 'User';
  @field name = contains(StringField);
  @field email = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name;
    },
  });
}

export class Team extends CardDef {
  static displayName = 'Team';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name;
    },
  });

  @field shortName = contains(StringField, {
    computeVia: function (this: Team) {
      return this.name ? this.name.slice(0, 2).toUpperCase() : undefined;
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      <Pill>
        <:default>
          {{@model.name}}
        </:default>
      </Pill>
    </template>
  };
}

export class TeamMember extends User {
  static displayName = 'Team Member';
  @field team = linksTo(Team);
}

export class Project extends CardDef {
  static displayName = 'Project';
  @field name = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: Project) {
      return this.name;
    },
  });
  static atom = class Atom extends Component<typeof this> {
    <template>
      <Pill class='project-pill'>
        <:default>
          {{@model.name}}
        </:default>
      </Pill>
      <style scoped>
        .project-pill {
          --boxel-pill-background-color: var(--boxel-purple);
          background: var(--profile-avatar-icon-background);
        }
      </style>
    </template>
  };
}

export class Issues extends CardDef {
  static displayName = 'Issues';
}

function extractId(href: string): string {
  const urlObj = new URL(href);
  const pathname = urlObj.pathname;
  const parts = pathname.split('/');
  const lastPart = parts[parts.length - 1];
  return lastPart.replace('.json', '');
}

function shortenId(id: string): string {
  const shortUuid = id.slice(0, 8);
  const decimal = parseInt(shortUuid, 16);
  return decimal.toString(36).padStart(6, '0');
}

class Fitted extends Component<typeof Task> {
  <template>
    <div class='task-card'>
      <div class='header'>
        <span class='short-id'>{{@model.shortId}}</span>
        <h3 class='task-title'>{{@model.taskName}}</h3>
      </div>
      <div class='footer'>
        <div class='footer-left'>
          {{#if @model.assignee}}
            <Avatar
              class='avatar'
              @userId={{@model.assignee.id}}
              @displayName={{@model.assignee.name}}
              @isReady={{true}}
            />
          {{/if}}
          {{#if @model.project.name}}
            <Pill>
              <:default>
                {{@model.project.name}}
              </:default>
            </Pill>
          {{/if}}
        </div>
        <div class='footer-right'>
          <@fields.dueDate />
        </div>
      </div>
    </div>
    <style scoped>
      .task-card {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        gap: var(--boxel-sp-sm);
        height: 100%;
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-sm);
        background-color: #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        transition: box-shadow 0.2s ease;
      }
      .footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .footer-left {
        display: flex;
        gap: var(--boxel-sp-xxs);
      }
      .short-id {
        color: var(--boxel-purple);
        font-size: var(--boxel-font-size-sm);
      }
      .task-title {
        font-size: 16px;
        font-weight: bold;
        color: #333;
        margin: 0;
      }
      .avatar {
        --profile-avatar-icon-size: 25px;
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 225px) or ( 100px < height < 120px)) {
        .footer-right {
          display: none; /* Hide dueDate when container is narrow */
        }
      }

      @container fitted-card (aspect-ratio <= 1.0) and ((width < 225px) and (height < 120px)) {
        .footer {
          display: none;
        }
      }

      @container fitted-card (1.0 < aspect-ratio <= 2.0) and (width < 200px) {
        .footer {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio > 2.0) and (height < 250px) {
        .footer {
          display: none;
        }
      }

      @container fitted-card (aspect-ratio < 1) and (height < 180px) {
        .task-title {
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      }
    </style>
  </template>
}

export class Tag extends CardDef {
  static displayName = 'Tag';
  @field name = contains(StringField);
}

export class Task extends CardDef {
  static displayName = 'Task';
  @field shortId = contains(StringField, {
    computeVia: function (this: Task) {
      if (this.id) {
        let id = shortenId(extractId(this.id));
        let _shortId: string;
        if (this.team && this.team.shortName) {
          // computeds are hard to debug -- the logs only appear on the server. We need to always include a check for links
          _shortId = this.team.shortName + '-' + id;
        } else {
          _shortId = id;
        }
        return _shortId.toUpperCase();
      }
      return;
    },
  });
  @field taskName = contains(StringField);
  @field taskDetail = contains(TextAreaCard);
  @field status = contains(TaskStatusField);
  @field priority = contains(TaskPriorityField);
  @field assignee = linksTo(TeamMember);
  @field project = linksTo(Project);
  @field team = linksTo(Team);
  @field dateStarted = contains(DateField);
  @field dueDate = contains(DateField);
  @field children = linksToMany(() => Task);
  @field tags = linksToMany(() => Tag);
  @field title = contains(StringField, {
    computeVia: function (this: Task) {
      return this.taskName;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='task-card'>
        <div class='task-header'>
          <h2 class='task-title'>{{@model.taskName}}</h2>
          <Pill>
            <:default>
              {{@model.status.label}}
            </:default>
          </Pill>
        </div>
        <div class='row-1'>
          <Avatar
            @userId={{@model.assignee.id}}
            @displayName={{@model.assignee.name}}
            @isReady={{true}}
          />
          {{@model.assignee.name}}
          {{#if this.hasDateRange}}
            <div class='task-dates'>
              {{@model.dateStarted}}
              -
              {{@model.dueDate}}</div>
          {{/if}}
        </div>
        <div class='row-2'>
          <Pill>
            <:default>
              {{@model.status.label}}
            </:default>
          </Pill>
          <div>
            Progress
            <ProgressBar @value={{50}} @max={{100}} />
            {{#if this.hasProgress}}
              50%
            {{/if}}
          </div>
        </div>
        <div>
          {{@model.taskDetail}}
        </div>
        <div>
          <@fields.children />
        </div>
      </div>
      <style>
        .task-card {
          display: flex;
          flex-direction: column;
          gap: var(--boxel-sp-sm);
        }
        .task-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .row-1 {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
        .row-2 {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }
      </style>
    </template>

    get hasDateRange() {
      return this.args.model.dateStarted && this.args.model.dueDate;
    }

    get hasProgress() {
      return this.args.model.children && this.args.model.children.length > 0;
    }
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='short-id'>{{@model.shortId}}</span>
      {{@model.taskName}}
      <Avatar
        @userId={{@model.assignee.id}}
        @displayName={{@model.assignee.name}}
        @isReady={{true}}
      />
      <style scoped>
        .short-id {
          color: var(--boxel-purple);
          font-size: var(--boxel-font-size-sm);
        }
      </style>
    </template>
  };

  static fitted = Fitted;
}
