// TIP: this file should be saved with "Save without formatting" in VSCode
// to avoid messing with the whitespace in the compiled card source
export const cardSrc = `
import {
  contains,
  field,
  Component,
  CardDef,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringField);
  @field cardTitle = contains(StringField, {
    computeVia: function (this: Person) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.firstName /></h1>
    </template>
  };
}

export let counter = 0;
export function increment() {
  counter++;
}
`.trim();

// `moduleIdentifier` is the identifier the realm tags the module's exported
// classes with: its URL without the extension, in canonical form.
export function compiledCard(
  id: string,
  moduleName: string,
  moduleIdentifier: string,
) {
  return `
import { contains, field, Component, CardDef } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { setComponentTemplate } from "@ember/component";
import { createTemplateFactory } from "@ember/template-factory";
export class Person extends CardDef {
  static [Symbol.for("ident")] = [${JSON.stringify(moduleIdentifier)}, "Person"];
  static displayName = 'Person';
  static {
    dt7948.g(this.prototype, "firstName", [field], function () {
      return contains(StringField);
    });
  }
  #firstName = (dt7948.i(this, "firstName"), void 0);
  static {
    dt7948.g(this.prototype, "cardTitle", [field], function () {
      return contains(StringField, {
        computeVia: function () {
          return this.firstName;
        }
      });
    });
  }
  #cardTitle = (dt7948.i(this, "cardTitle"), void 0);
  static isolated = class Isolated extends Component {
    static {
      setComponentTemplate(createTemplateFactory(
      /*
        <h1 data-test-card><@fields.firstName /></h1>
      */
      {
        "id": ${id},
        "block": "[[[10,\\"h1\\"],[14,\\"data-test-card\\",\\"\\"],[12],[8,[30,1,[\\"firstName\\"]],null,null,null],[13]],[\\"@fields\\"],[]]",
        "moduleName": "${moduleName}",
        "isStrictMode": true
      }), this);
    }
  };}
export let counter = 0;
export function increment() {
  counter++;
}`.trim();
}
