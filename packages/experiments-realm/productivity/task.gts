import {
  CardDef,
  Component,
  FieldDef,
  StringField,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import NumberField from 'https://cardstack.com/base/number';
import { BoxelSelect } from '@cardstack/boxel-ui/components';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import DateField from 'https://cardstack.com/base/date';
import TextAreaCard from '../../base/text-area';

export class StatusField extends FieldDef {
  @field index = contains(NumberField); //sorting order
  @field label = contains(StringField);
  // @field statuses = containsMany(StatuField)
  // bcos we don't have guides we have to repeat the statuses array filling up

  statuses: StatusFieldData[] = []; //help with the types
}

interface StatusFieldData {
  index?: number;
  label?: string;
}

class Edit extends Component<typeof StatusField> {
  @tracked label: string | undefined = this.args.model.label;
  //we can optionally track the selectedStatus here, but we must
  // ensure we choose do not create a separate instance of object in options

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
    //#Pattern1: Updating field of containsMany
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
    { index: 0, label: 'To Do' },
    {
      index: 1,
      label: 'In Progress',
    },
    {
      index: 2,
      label: 'Done',
    },
  ];

  static edit = Edit;
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

  static edit = Edit;
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
}

export class Issues extends CardDef {
  static displayName = 'Issues';
}

export class Task extends CardDef {
  static displayName = 'Task';
  @field taskName = contains(StringField);
  @field taskDetail = contains(TextAreaCard);
  @field status = contains(TaskStatusField);
  @field priority = contains(TaskPriorityField);
  @field assignee = linksTo(TeamMember);
  @field project = linksTo(Project);
  @field dueDate = contains(DateField);

  @field title = contains(StringField, {
    computeVia: function (this: Task) {
      return this.taskName;
    },
  });

  static atom = class Atom extends Component<typeof this> {
    <template>
      {{@model.taskName}}
    </template>
  };
}
