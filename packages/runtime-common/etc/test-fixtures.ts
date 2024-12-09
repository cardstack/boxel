/* eslint-disable no-useless-escape */
export const cardSrc = `
import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringCard);
  @field title = contains(StringCard, {
    computeVia: function (this: Person) {
      return this.firstName;
    },
  });
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <h1 data-test-card><@fields.firstName /></h1>
    </template>
  };
}`.trim();

export function compiledCard(id = 'null', moduleName = '/dir/person.gts') {
  return `
import { setComponentTemplate } from "@ember/component";
import { contains, field, Component, CardDef } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { createTemplateFactory } from "@ember/template-factory";
export class Person extends CardDef {
  static displayName = 'Person';
  static {
    dt7948.g(this.prototype, "firstName", [field], function () {
      return contains(StringCard);
    });
  }
  #firstName = (dt7948.i(this, "firstName"), void 0);
  static {
    dt7948.g(this.prototype, "title", [field], function () {
      return contains(StringCard, {
        computeVia: function () {
          return this.firstName;
        }
      });
    });
  }
  #title = (dt7948.i(this, "title"), void 0);
  static isolated = setComponentTemplate(createTemplateFactory(
  /*
    
        <h1 data-test-card><@fields.firstName /></h1>
      
  */
  {
    "id": ${id},
    "block": "[[[1,\\"\\\\n      \\"],[10,\\"h1\\"],[14,\\"data-test-card\\",\\"\\"],[12],[8,[30,1,[\\"firstName\\"]],null,null,null],[13],[1,\\"\\\\n    \\"]],[\\"@fields\\"],false,[]]",
    "moduleName": "${moduleName}",
    "isStrictMode": true
  }), class Isolated extends Component {});
}
  `.trim();
}
