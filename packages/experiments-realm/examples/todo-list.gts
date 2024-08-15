import BooleanField from 'https://cardstack.com/base/boolean';
import {
  CardDef,
  field,
  contains,
  StringField,
  FieldDef,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { on } from '@ember/modifier';

export class TodoField extends FieldDef {
  @field name = contains(StringField);
  @field isComplete = contains(BooleanField);
  @field isActive = contains(BooleanField, {
    computeVia: function (this: TodoField) {
      return !this.isComplete;
    },
  });
  @field title = contains(StringField, {
    computeVia: function (this: TodoField) {
      return `${this.isComplete ? '[DONE]' : ''} ${this.name}`;
    },
  });
  static displayName = 'Todo';

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <input type='checkbox' {{on 'change' this.toggleComplete}} />
      {{@model.name}}
    </template>

    @action toggleComplete() {
      this.args.model.isComplete = !this.args.model.isComplete;
    }
  };
}

export class TodoList extends CardDef {
  static displayName = 'TodoList';
  @field todos = containsMany(TodoField);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h2>My Task for the day </h2>
      {{! <@fields.todos /> }}
      {{#each @fields.todos as |t|}}
        <div style='height:30px'>
          <t />
        </div>
      {{/each}}
    </template>
  };
}
