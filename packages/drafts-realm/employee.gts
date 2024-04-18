import {
  contains,
  field,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Person } from './person';

export class Employee extends Person {
  static displayName = 'Employee';
  @field department = contains(StringField);
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <@fields.firstName /> from <em><@fields.department /></em>
    </template>
  };
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <div class='container'>
        <h1><@fields.title /></h1>
        <h1><@fields.firstName /> <@fields.lastName /></h1>
        <div><@fields.isCool /></div>
        <div><@fields.isHuman /></div>
        <div>Department: <@fields.department /></div>
      </div>
      <style>
        .container {
          padding: var(--boxel-sp-xl);
        }
      </style>
    </template>
  };
}
