export const cardSrc = `
import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';

export class Person extends CardDef {
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
var _class, _descriptor, _descriptor2, _class2;
import { setComponentTemplate } from \"@ember/component\";
function _initializerDefineProperty(target, property, descriptor, context) { if (!descriptor) return; Object.defineProperty(target, property, { enumerable: descriptor.enumerable, configurable: descriptor.configurable, writable: descriptor.writable, value: descriptor.initializer ? descriptor.initializer.call(context) : void 0 }); }
function _defineProperty(obj, key, value) { key = _toPropertyKey(key); if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }
function _toPropertyKey(arg) { var key = _toPrimitive(arg, \"string\"); return typeof key === \"symbol\" ? key : String(key); }
function _toPrimitive(input, hint) { if (typeof input !== \"object\" || input === null) return input; var prim = input[Symbol.toPrimitive]; if (prim !== undefined) { var res = prim.call(input, hint || \"default\"); if (typeof res !== \"object\") return res; throw new TypeError(\"@@toPrimitive must return a primitive value.\"); } return (hint === \"string\" ? String : Number)(input); }
function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }
function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'transform-class-properties is enabled and runs after the decorators transform.'); }
import { contains, field, Component, CardDef } from 'https://cardstack.com/base/card-api';
import StringCard from 'https://cardstack.com/base/string';
import { createTemplateFactory } from \"@ember/template-factory\";
export let Person = (_class = (_class2 = class Person extends CardDef {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, \"firstName\", _descriptor, this);
    _initializerDefineProperty(this, \"title\", _descriptor2, this);
  }
}, _defineProperty(_class2, \"isolated\", setComponentTemplate(createTemplateFactory(
/*
\ \ 
      <h1 data-test-card><@fields.firstName /></h1>
\ \ \ \ 
*/
{
  \"id\": ${id},
  \"block\": \"[[[1,\\\"\\\\n      \\\"],[10,\\\"h1\\\"],[14,\\\"data-test-card\\\",\\\"\\\"],[12],[8,[30,1,[\\\"firstName\\\"]],null,null,null],[13],[1,\\\"\\\\n    \\\"]],[\\\"@fields\\\"],false,[]]\",
  \"moduleName\": \"${moduleName}\",
  \"isStrictMode\": true
}), class Isolated extends Component {})), _class2), (_descriptor = _applyDecoratedDescriptor(_class.prototype, \"firstName\", [field], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: function () {
    return contains(StringCard);
  }
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, \"title\", [field], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: function () {
    return contains(StringCard, {
      computeVia: function () {
        return this.firstName;
      }
    });
  }
})), _class);
  `.trim();
}
