/* eslint-disable no-useless-escape */
export const cardSrc = `
import {
  contains,
  field,
  Component,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  static displayName = 'Person';
  @field firstName = contains(StringField);
  @field title = contains(StringField, {
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
function _toPropertyKey(t) { var i = _toPrimitive(t, \"string\"); return "symbol" == typeof i ? i : i + ""; }
function _toPrimitive(t, r) { if ("object" != typeof t || !t) return t; var e = t[Symbol.toPrimitive]; if (void 0 !== e) { var i = e.call(t, r || "default"); if ("object" != typeof i) return i; throw new TypeError(\"@@toPrimitive must return a primitive value.\"); } return ("string" === r ? String : Number)(t); }
function _applyDecoratedDescriptor(target, property, decorators, descriptor, context) { var desc = {}; Object.keys(descriptor).forEach(function (key) { desc[key] = descriptor[key]; }); desc.enumerable = !!desc.enumerable; desc.configurable = !!desc.configurable; if ('value' in desc || desc.initializer) { desc.writable = true; } desc = decorators.slice().reverse().reduce(function (desc, decorator) { return decorator(target, property, desc) || desc; }, desc); if (context && desc.initializer !== void 0) { desc.value = desc.initializer ? desc.initializer.call(context) : void 0; desc.initializer = undefined; } if (desc.initializer === void 0) { Object.defineProperty(target, property, desc); desc = null; } return desc; }
function _initializerWarningHelper(descriptor, context) { throw new Error('Decorating class property failed. Please ensure that ' + 'transform-class-properties is enabled and runs after the decorators transform.'); }
import { contains, field, Component, CardDef } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { createTemplateFactory } from \"@ember/template-factory\";
export let Person = (_class = (_class2 = class Person extends CardDef {
  constructor(...args) {
    super(...args);
    _initializerDefineProperty(this, \"firstName\", _descriptor, this);
    _initializerDefineProperty(this, \"title\", _descriptor2, this);
  }
}, _defineProperty(_class2, "displayName", 'Person'), _defineProperty(_class2, \"isolated\", setComponentTemplate(createTemplateFactory(
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
    return contains(StringField);
  }
}), _descriptor2 = _applyDecoratedDescriptor(_class.prototype, \"title\", [field], {
  configurable: true,
  enumerable: true,
  writable: true,
  initializer: function () {
    return contains(StringField, {
      computeVia: function () {
        return this.firstName;
      }
    });
  }
})), _class);
  `.trim();
}
