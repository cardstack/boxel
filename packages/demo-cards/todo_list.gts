import {
  contains,
  field,
  Card,
  Component,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import BooleanCard from 'https://cardstack.com/base/boolean';
import { CardContainer } from '@cardstack/boxel-ui';

class TodoItem extends Card {
  @field title = contains(StringCard); // required
  @field completed = contains(BooleanCard); // checkbox
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div>
        <input type='checkbox' checked={{@model.completed}} />
        <span>{{@model.title}}</span>
      </div>
    </template>
  };
}

export class TodoList extends Card {
  @field title = contains(StringCard); // required
  @field items = containsMany(TodoItem);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='todo-list'>
        <h2>{{@model.title}}</h2>
        {{#each @model.items as |item|}}
          <@fields.items item={{item}} />
        {{/each}}
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class='todo-list'>
        <h2><@fields.title /></h2>
        {{#each @model.items as |item|}}
          <FieldContainer>
            <@fields.items item={{item}} />
          </FieldContainer>
        {{/each}}
      </CardContainer>
    </template>
  };
}