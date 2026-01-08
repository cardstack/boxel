import GlimmerComponent from '@glimmer/component';
import {
  type CardDef,
  type PartialBaseInstanceType,
  Box,
  type Field,
} from 'https://cardstack.com/base/card-api';
import {
  getBoxComponent,
  type BoxComponent,
} from 'https://cardstack.com/base/field-component';
import { initSharedState } from 'https://cardstack.com/base/shared-state';

const fieldRendererCache = initSharedState(
  'fieldRendererCache',
  () => new WeakMap<object, { box: Box<CardDef>; fieldsProxy: BoxComponent }>(),
);

interface FieldInfo {
  name: string;
  fieldType: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  value: any;
  component?: BoxComponent;
}

interface FieldRendererSignature {
  Args: {
    instance: CardDef | PartialBaseInstanceType<typeof CardDef>;
    fieldName: string;
    showComputedFields?: boolean;
    usedLinksToFieldsOnly?: boolean;
    fields?: { [fieldName: string]: Field };
  };
  Element: HTMLElement;
  Blocks: {
    default: [field: FieldInfo | undefined];
  };
}

// We use a single field-renderer here. If we used fields renderer as a row, we have to take
// into account how the template re-renders so there is no flickering
export class FieldRenderer extends GlimmerComponent<FieldRendererSignature> {
  get fieldsProxy() {
    let cached = fieldRendererCache.get(this.args.instance as object);
    if (!cached) {
      const box = Box.create(this.args.instance as CardDef);
      const fieldsProxy = getBoxComponent(
        this.args.instance.constructor,
        box,
        undefined,
      );
      cached = { box, fieldsProxy };
      fieldRendererCache.set(this.args.instance as object, cached);
    }
    return cached.fieldsProxy;
  }

  get field(): FieldInfo | undefined {
    const instanceFields = this.args.fields;
    const fieldInfo = instanceFields?.[this.args.fieldName];
    if (!fieldInfo) return undefined;

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
