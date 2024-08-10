import {
  CardDef,
  field,
  contains,
  StringField,
} from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { restartableTask } from 'ember-concurrency';
import { eq } from '@cardstack/boxel-ui/helpers';

class Isolated extends Component<typeof CodeSource> {
  private createModule = restartableTask(async (model) => {
    let url = `http://localhost:4201/experiments/${model.name}/1.gts`;
    let response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.card+source',
      },
      body: `
import { CardDef, FieldDef, linksTo, linksToMany, field, contains, containsMany } from 'https://cardstack.com/base/card-api';
import { Component } from 'https://cardstack.com/base/card-api';


import StringField from 'https://cardstack.com/base/string';
import BooleanField from 'https://cardstack.com/base/boolean';
import DateField from 'https://cardstack.com/base/date';
import DateTimeField from 'https://cardstack.com/base/datetime';
import NumberField from 'https://cardstack.com/base/number';

import MarkdownField from 'https://cardstack.com/base/markdown';



export class ${model.name}  extends CardDef {
  static displayName = '${model.name}';

   ${model.fieldsCode}

 static isolated = class Isolated extends Component<typeof ${model.name}> {
    ${model.templateCode}

    <template>
      ${model.templateMarkup}
      <style>
      ${model.templateStyle}
      </style>
    </template>
 };
}

      `,
    });

    if (!response.ok) {
      let errorMessage = `Could not write file ${url}, status ${
        response.status
      }: ${response.statusText} - ${await response.text()}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  });

  @action
  handleCreateModule() {
    this.createModule.perform(this.args.model);
  }

  <template>
    <div class='code-source-container'>
      <button
        {{on 'click' this.handleCreateModule}}
        class='create-button'
        disabled={{this.createModule.isRunning}}
      >Create Module</button>

      <div class='field-display'>
        <h2>{{this.args.model.name}}</h2>

        <div class='field'>
          <label>Name:</label>
          <span>{{this.args.model.name}}</span>
        </div>

        <div class='field'>
          <label>Realm:</label>
          <span>{{this.args.model.realm}}</span>
        </div>

        <div class='field'>
          <label>Template Markup:</label>
          <pre>{{this.args.model.templateMarkup}}</pre>
        </div>

        <div class='field'>
          <label>Template Code:</label>
          <pre>{{this.args.model.templateCode}}</pre>
        </div>

        <div class='field'>
          <label>Template Style:</label>
          <pre>{{this.args.model.templateStyle}}</pre>
        </div>

        <div class='field'>
          <label>Fields Code:</label>
          <pre>{{this.args.model.fieldsCode}}</pre>
        </div>
      </div>
    </div>

    <style>
      .code-source-container {
        padding: 20px;
        font-family: Arial, sans-serif;
      }
      .create-button {
        background-color: #4caf50;
        border: none;
        color: white;
        padding: 15px 32px;
        text-align: center;
        text-decoration: none;
        display: inline-block;
        font-size: 16px;
        margin-bottom: 20px;
        cursor: pointer;
      }
      .field-display {
        background-color: #f9f9f9;
        border: 1px solid #ddd;
        border-radius: 5px;
        padding: 20px;
      }
      .field {
        margin-bottom: 15px;
      }
      .field label {
        font-weight: bold;
        display: block;
        margin-bottom: 5px;
      }
      .field pre {
        background-color: #eee;
        padding: 10px;
        border-radius: 3px;
        white-space: pre-wrap;
        word-wrap: break-word;
      }
    </style>
  </template>
}

export class CodeSource extends CardDef {
  @field name = contains(StringField);
  @field realm = contains(StringField);

  @field templateMarkup = contains(StringField, {
    description: `Code that fits within <template></template> for a glimmer template. 
    Do not include the CSS style.
    Embers on, glimmers tracking and embers object action have been imported for you, nothing else should be assumed to exist.
    Delegate to subcomponents to render using the syntax <field.fieldName/>
    Pull the value out using {{this.args.model.fieldName}}`,
  });
  @field templateCode = contains(StringField, {
    description: 'Additional functions required to support the template markup',
  });
  @field templateStyle = contains(StringField, {
    description: ``,
  });
  @field fieldsCode = contains(StringField, {
    description: `Use typescript for the code. Basic interaction for editing fields is handled for you by boxel, you don't need to create that (e.g. StringField has an edit template that allows a user to edit the data). Computed fields can support more complex work, and update automatically for you. Interaction (button clicks, filtering on user typed content) will require work on templates that will happen elsewhere and is not yours to do.

Never leave sections of code unfilled or with placeholders, finish all code you write.

You have available:

StringField
MarkdownField
NumberField
BooleanField
DateField
DateTimeField

Fields do not have default values.

Computed fields can be created with a computeVia function

 @field computedData = contains(NumberField, {
   computeVia: function (this) {
     // implementation logic here
     return 1;
   }});


Use contains for a single field and containsMany for a list.

Example for a booking form:

@field guestNames = containsMany(StringField);
@field startDate = contains(DateField);
@field endDate = contains(DateField);
@field guests = contains(NumberField, {
   computeVia: function (this) {
     return guestNames.length;
   })

`,
  });

  static displayName = 'CodeSource';

  static isolated = Isolated;

  /*

  static embedded = class Embedded extends Component<typeof this> {
    <template></template>
  }

  static atom = class Atom extends Component<typeof this> {
    <template></template>
  }

  static edit = class Edit extends Component<typeof this> {
    <template></template>
  }








  */
}
