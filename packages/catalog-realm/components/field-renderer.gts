import GlimmerComponent from '@glimmer/component';
import {
  getFields,
  type CardDef,
  Box,
} from 'https://cardstack.com/base/card-api';
import {
  getBoxComponent,
  type BoxComponent,
} from 'https://cardstack.com/base/field-component';
import { initSharedState } from 'https://cardstack.com/base/shared-state';

const fieldRendererCache = initSharedState(
  'fieldRendererCache',
  () =>
    new WeakMap<CardDef, { box: Box<CardDef>; fieldsProxy: BoxComponent }>(),
);

interface FieldInfo {
  name: string;
  fieldType: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  value: any;
  component?: BoxComponent;
}

interface FieldRendererSignature {
  Args: {
    instance: CardDef;
    fieldName: string;
    showComputedFields?: boolean;
    usedLinksToFieldsOnly?: boolean;
  };
  Element: HTMLElement;
  Blocks: {
    default: [field: FieldInfo];
  };
}

// We use a single field-renderer here. If we used fields renderer as a row, we have to take
// into account how the template re-renders so there is no flickering
export class FieldRenderer extends GlimmerComponent<FieldRendererSignature> {
  get fieldsProxy() {
    let cached = fieldRendererCache.get(this.args.instance);
    if (!cached) {
      const box = Box.create(this.args.instance);
      const fieldsProxy = getBoxComponent(
        this.args.instance.constructor,
        box,
        undefined,
      );
      cached = { box, fieldsProxy };
      fieldRendererCache.set(this.args.instance, cached);
    }
    return cached.fieldsProxy;
  }

  get field(): FieldInfo {
    const instanceFields = getFields(this.args.instance.constructor, {
      includeComputeds: this.args.showComputedFields ?? false,
      usedLinksToFieldsOnly: this.args.usedLinksToFieldsOnly ?? false,
    });

    const fieldInfo = instanceFields[this.args.fieldName];

    const fieldValue = (this.args.instance as any)[this.args.fieldName];
    const fieldComponent = (this.fieldsProxy as any)[
      this.args.fieldName
    ] as BoxComponent;

    return {
      name: this.args.fieldName,
      fieldType: fieldInfo.fieldType,
      value: fieldValue,
      component: fieldComponent,
    };
  }

  <template>
    {{yield this.field}}
  </template>
}
