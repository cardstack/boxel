import {
  contains,
  field,
  Card,
  Component,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { CardContainer, FieldContainer } from '@cardstack/boxel-ui';
import { startCase } from 'lodash';

class Employee extends Card {
  @field firstName = contains(StringCard); // required
  @field lastName = contains(StringCard); // required
  @field jobTitle = contains(StringCard); // required
  @field email = contains(StringCard); // email format
  @field phone = contains(StringCard); // phone number format
  @field department = contains(StringCard); // required
  @field manager = contains(StringCard);
  @field photoURL = contains(StringCard); // url format

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='employee-card'>
        <img src={{@model.photoURL}} />
        <div>
          <h2>{{@model.firstName}} {{@model.lastName}}</h2>
          <FieldContainer @label='Job Title'>
            <@fields.jobTitle />
          </FieldContainer>
          <FieldContainer @label='Department'>
            <@fields.department />
          </FieldContainer>
          {{#if @model.manager}}
            <FieldContainer @label='Manager'>
              <@fields.manager />
            </FieldContainer>
          {{/if}}
          <FieldContainer @label='Email'>
            <@fields.email />
          </FieldContainer>
          <FieldContainer @label='Phone'>
            <@fields.phone />
          </FieldContainer>
        </div>
      </CardContainer>
    </template>
  };
}

export class EmployeeDirectory extends Card {
  @field employees = containsMany(Employee); // required

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <CardContainer class='employee-directory'>
        <FieldContainer @label='Employees'>
          <@fields.employees />
        </FieldContainer>
      </CardContainer>
    </template>
  };
}