import { Person } from '../person';
import BooleanField from '../../base/boolean';
import {
  CardDef,
  FieldDef,
  StringField,
  contains,
  field,
  linksToMany,
  linksTo,
  Component,
} from 'https://cardstack.com/base/card-api';
import DateField from 'https://cardstack.com/base/date';
import NumberField from 'https://cardstack.com/base/number';
class StatusField extends FieldDef {
  @field code = contains(NumberField);
  @field label = contains(StringField);
}

//Version 1
class TaskStatusField extends StatusField {
  statuses = [
    { code: null, index: 1, label: 'New' },
    { code: null, index: 2, label: 'Contacted' },
    { code: null, index: 3, label: 'Qualified' },
    { code: null, index: 4, label: 'Unqualified' },
    { code: null, index: 5, label: 'Nurturing' },
    { code: null, index: 6, label: 'Proposal Sent' },
    { code: null, index: 7, label: 'Negotiation' },
    { code: null, index: 8, label: 'Closed - Won' },
    { code: null, index: 9, label: 'Closed - Lost' },
    { code: null, index: 10, label: 'No Response' },
  ];
}

class PriorityField extends StatusField {
  priority = [
    { code: null, index: 1, label: 'Low' },
    { code: null, index: 2, label: 'Medium' },
    { code: null, index: 3, label: 'High' },
  ];
}

export class Task extends CardDef {
  static displayName = 'Task Form';
  @field content = contains(StringField);
  @field completed = contains(BooleanField);
  @field status = contains(TaskStatusField);
}

export class ManagedTask extends Task {
  @field dueDate = contains(DateField);
  @field priority = contains(PriorityField);
}

class Fitted extends Component<typeof AssignedTask> {
  <template>
    <div class='assigned-task-card'>
      <h3 class='task-title'>{{@model.content}} </h3>
      <p class='task-assignee'>Assigned to: {{@model.assignee.firstName}}</p>
      <p class='task-status'>Status: {{@model.status.label}}</p>
      <p class='task-due-date'>Due Date: <@fields.dueDate /></p>
    </div>
    <style scoped>
      .assigned-task-card {
        border: 1px solid #ccc;
        border-radius: 8px;
        padding: 16px;
        background-color: #f9f9f9;
      }
      .task-title {
        font-size: 18px;
        font-weight: bold;
      }
      .task-assignee,
      .task-status,
      .task-due-date {
        margin: 4px 0;
      }
    </style>
  </template>
}
export class AssignedTask extends ManagedTask {
  @field assignee = linksTo(Person);

  // New Fitted template for AssignedTask
  static fitted = Fitted;
}

//app card is a smart collection (a lens)
//this is task list is manual list

//https://todomvc.com/examples/react/dist/#/
//isolated mode which is editable
//use hacky javascript. dont use command architecture
export class TodoList extends CardDef {
  @field tasks = linksToMany(Task);

  // @action
  // clearCompleted
  // unlink but every completed task

  // completed
  // remaining
  // how many items left
  // clear completed

  // isolated view
  // - task list
  // - kanban view
}

export class ProgressTracker extends CardDef {
  @field tasks = linksToMany(ManagedTask);
}

//Version 2

//3 apps
// - todoist. manual collection
// - task with statuses / kanban. Its an app card. tile is embedded ratio
// - linear edit anything at anytime (skip is too little)

// important things to go thru
// mutate realm
// lens

// crm should be related , task with statuses and assignment and linear
