import MarkdownField from 'https://cardstack.com/base/markdown';
import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import DateCard from 'https://cardstack.com/base/date';
import StringField from 'https://cardstack.com/base/string';
import {
  BoxelSelect,
  CardContainer,
  FieldContainer,
} from '@cardstack/boxel-ui/components';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { CrmAccount } from './crm/account';

interface CategorySignature {
  name: string;
}

/* Task Form */
class IsolatedSecForTaskForm extends Component<typeof TaskForm> {
  <template>
    <CardContainer @displayBoundaries={{false}} class='container'>
      <div class='field-input'>
        <label>Subject: </label>
        <div><@fields.subject /></div>
      </div>

      <div class='field-input-column'>
        <label>Comments: </label>
        <div class='comments-container'>
          <@fields.comments />
        </div>
      </div>

      <div class='field-input'>
        <label>Due Date: </label>
        <@fields.dueDate />
      </div>

      <div class='field-input-column'>
        <label>Related To: </label>
        <@fields.relatedTo />
      </div>
    </CardContainer>

    <style>
      .container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp-lg);
      }
      .comments-container {
        display: flex;
        flex-direction: column;
        justify-content: space-evenly;
        padding: var(--boxel-sp-xs) var(--boxel-sp);
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        font-weight: 700;
      }
      .field-input {
        display: flex;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        flex-wrap: wrap;
      }
      .field-input-column {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-sm);
        flex-wrap: wrap;
      }
      label {
        font-weight: 700;
      }
    </style>
  </template>
}

class ViewSecForTaskForm extends Component<typeof TaskForm> {
  <template>
    <CardContainer @displayBoundaries={{false}} class='container'>
      <h2><@fields.subject /></h2>

      <div class='details-container'>
        <div class='details-heading'>Details</div>
        <div class='details-content'>
          <FieldContainer @tag='label' @label='Related To' @vertical={{false}}>
            <@fields.relatedTo />
          </FieldContainer>

          <FieldContainer @tag='label' @label='Due Date' @vertical={{false}}>
            <@fields.dueDate />
          </FieldContainer>
        </div>
      </div>
    </CardContainer>

    <style>
      .container {
        display: grid;
        background: white;
      }
      .details-container {
        border: 1px solid var(--boxel-form-control-border-color);
        margin-top: 1rem;
      }
      .details-container > * + * {
        border-top: 1px dashed var(--boxel-form-control-border-color);
        border-bottom-width: 0px;
      }
      .details-content {
        background-color: #fbfbfb;
        display: grid;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp) var(--boxel-sp-lg);
      }
      .details-heading {
        background: #f8f8f8;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        font-weight: bold;
      }
      h2 {
        margin: 0px;
      }
    </style>
  </template>
}

class EditSecForTaskForm extends Component<typeof TaskForm> {
  get selectedSubject() {
    return { name: this.args.model.subject || 'None' };
  }

  @tracked subjectOptions = [
    { name: 'None' },
    { name: 'Email' },
    { name: 'Call' },
    { name: 'Send Letter' },
    { name: 'Send Quote' },
    { name: 'Other' },
  ] as Array<CategorySignature>;

  @action updateSubject(type: { name: string }) {
    this.args.model.subject = type.name;
  }

  <template>
    <CardContainer @displayBoundaries={{false}} class='container'>
      <FieldContainer @tag='label' @label='Subject' @vertical={{true}}>
        <BoxelSelect
          @searchEnabled={{true}}
          @searchField='name'
          @selected={{this.selectedSubject}}
          @onChange={{this.updateSubject}}
          @options={{this.subjectOptions}}
          class='select'
          as |item|
        >
          <div>{{item.name}}</div>
        </BoxelSelect>
      </FieldContainer>

      <FieldContainer @tag='label' @label='Due Date' @vertical={{true}}>
        <@fields.dueDate />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Comments' @vertical={{true}}>
        <@fields.comments />
      </FieldContainer>

      <FieldContainer @tag='label' @label='Related To' @vertical={{true}}>
        <@fields.relatedTo />
      </FieldContainer>
    </CardContainer>

    <style>
      .container {
        padding: var(--boxel-sp-lg);
        display: grid;
        gap: var(--boxel-sp);
      }
      .select {
        padding: var(--boxel-sp-xs);
        background-color: white;
      }
    </style>
  </template>
}

export class TaskForm extends CardDef {
  static displayName = 'Task Form';
  @field subject = contains(StringField, {
    description: `Subject`,
  });
  @field dueDate = contains(DateCard, {
    description: `Due Date`,
  });
  @field comments = contains(MarkdownField, {
    description: `Comments`,
  });
  @field relatedTo = linksTo(CrmAccount, {
    description: `Related to Crm Account`,
  });

  static isolated = IsolatedSecForTaskForm;
  static atom = ViewSecForTaskForm;
  static embedded = ViewSecForTaskForm;
  static edit = EditSecForTaskForm;
}
