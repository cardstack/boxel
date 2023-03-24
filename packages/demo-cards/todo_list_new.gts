import {
  contains,
  field,
  Card,
  Component,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import BooleanCard from 'https://cardstack.com/base/boolean';

class TodoItem extends Card {
  @field task = contains(StringCard); // required
  @field completed = contains(BooleanCard); // checkbox
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='todo-item-card'>
        <FieldContainer>
          <input type='checkbox' checked={{@model.completed}} />
          <@fields.task />
        </FieldContainer>
      </CardContainer>
    </template>
  };
}

export class TodoListNew extends Card {
  @field title = contains(StringCard); // required
  @field items = containsMany(TodoItem); // required
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='todo-list-card'>
        <h2><@fields.title /></h2>
        <ul>
          <@fields.items />
        </ul>
      </CardContainer>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <CardContainer class='todo-list-card'>
        <h2><@fields.title /></h2>
        <ul>
          <@fields.items />
        </ul>
      </CardContainer>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <CardContainer class='todo-list-card'>
        <FieldContainer @label='Title'>
          <@fields.title />
        </FieldContainer>
        <FieldContainer @label='Items'>
          <@fields.items />
        </FieldContainer>
      </CardContainer>
    </template>
  };
}
