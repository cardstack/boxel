import BooleanField from '../../base/boolean';
import {
  CardDef,
  StringField,
  contains,
  field,
  linksToMany,
} from '../../base/card-api';

class TaskStatus extends StringField {
  // code is used for sorting order. For natural ordering
  @field displayName = contains(StringField);
  @field completed = contains(BooleanField);
  //filter of statuses only happen inside the component
}

export class ToDoListTask extends CardDef {
  static displayName = 'Task Form';
  @field content = contains(StringField);
  @field status = contains(TaskStatus);
}

//app card is a smart collection (a lens)
//this is task list is manual list

//https://todomvc.com/examples/react/dist/#/
//isolated mode which is editable
//use hacky javascript. dont use command architecture
export class TaskList extends CardDef {
  @field tasks = linksToMany(ToDoListTask);

  // @action
  // clearCompleted
  // unlink but every completed task

  // completed
  // remaining
  // how many items left
  // clear completed
}

//3 apps
// - todoist. manual collection
// - task with statuses / kanban. Its an app card. tile is embedded ratio
// - linear edit anything at anytime (skip is too little)

// important things to go thru
// mutate realm
// lens

// crm should be related , task with statuses and assignment and linear
