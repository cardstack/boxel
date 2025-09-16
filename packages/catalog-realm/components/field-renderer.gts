/**
 * # Field Renderer Components
 *
 * This module provides components for dynamically rendering card fields with full control
 * over the presentation. It extracts field metadata and components from card instances,
 * allowing consumers to build custom layouts and interfaces.
 *
 * ## Components
 *
 * ### FieldRenderer
 *
 * A flexible component that yields an array of field information for a given card instance.
 * The consumer receives field metadata and renderable components to build custom layouts.
 *
 * **Arguments:**
 * - `@instance` (CardDef) - The card instance to extract fields from
 * - `@showComputedFields` (boolean, optional) - Include computed fields (default: false)
 * - `@usedLinksToFieldsOnly` (boolean, optional) - Only include fields that are used as links (default: false)
 *
 * **Yields:**
 * Array of FieldInfo objects with:
 * - `name` (string) - The field name
 * - `fieldType` ('contains' | 'containsMany' | 'linksTo' | 'linksToMany') - Field type
 * - `value` (any) - Current field value
 * - `component` (Component) - Renderable field component
 *
 * **Example Usage:**
 * ```gts
 * <FieldRenderer @instance={{@card}} as |fields|>
 *   <div class="card-fields">
 *     {{#each fields as |field|}}
 *       <div class="field-wrapper" data-field-type={{field.fieldType}}>
 *         <label>{{field.name}}</label>
 *         {{#if field.component}}
 *           <field.component @format="edit" />
 *         {{else}}
 *           <span class="field-value">{{field.value}}</span>
 *         {{/if}}
 *       </div>
 *     {{/each}}
 *   </div>
 * </FieldRenderer>
 * ```
 *
 * **Custom Layout Example:**
 * ```gts
 * <FieldRenderer @instance={{@person}} as |fields|>
 *   <div class="person-card">
 *     {{#each fields as |field|}}
 *       {{#if (eq field.name "name")}}
 *         <h1><field.component @format="fitted" /></h1>
 *       {{else if (eq field.name "email")}}
 *         <div class="contact"><field.component /></div>
 *       {{else}}
 *         <div class="other-field">
 *           <strong>{{field.name}}:</strong>
 *           <field.component @format="embedded" />
 *         </div>
 *       {{/if}}
 *     {{/each}}
 *   </div>
 * </FieldRenderer>
 * ```
 *
 * ### SingleFieldRenderer
 *
 * Renders a specific field from a card instance with built-in handling for different
 * field types. Useful when you need to render individual fields in specific contexts.
 *
 * **Arguments:**
 * - `@instance` (CardDef) - The card instance
 * - `@fieldName` (string) - Name of the field to render
 * - `@showComputedFields` (boolean, optional) - Include computed fields (default: false)
 * - `@usedLinksToFieldsOnly` (boolean, optional) - Only include fields that are used as links (default: false)
 *
 * **Example Usage:**
 * ```gts
 * <SingleFieldRenderer
 *   @instance={{@product}}
 *   @fieldName="price"
 *   as |field|
 * >
 *   <field.component @format="fitted" />
 * </SingleFieldRenderer>
 * ```
 *
 * ## Field Types
 *
 * The FieldInfo object includes a fieldType property that indicates:
 * - **contains**: Field contains a nested card/field component
 * - **linksTo**: Field links to a single card
 * - **containsMany**: Field contains multiple nested cards/fields
 * - **linksToMany**: Field links to multiple cards
 *
 * ## Advanced Patterns
 *
 * **Conditional Rendering:**
 * ```gts
 * <FieldRenderer @instance={{@card}} as |fields|>
 *   {{#each fields as |field|}}
 *     {{#if (eq field.fieldType "contains")}}
 *       <field.component @format="edit" />
 *     {{else if (eq field.fieldType "linksTo")}}
 *       <CustomLinkDisplay @value={{field.value}} />
 *     {{/if}}
 *   {{/each}}
 * </FieldRenderer>
 * ```
 *
 * **Grouped Layout:**
 * ```gts
 * <FieldRenderer @instance={{@card}} as |fields|>
 *   <div class="primary-fields">
 *     {{#each (filter-by "fieldType" "contains" fields) as |field|}}
 *       <field.component @format="edit" />
 *     {{/each}}
 *   </div>
 *   <div class="relationship-fields">
 *     {{#each (filter-by "fieldType" "linksTo" fields) as |field|}}
 *       <field.component @format="fitted" />
 *     {{/each}}
 *   </div>
 * </FieldRenderer>
 * ```
 */

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
    showComputedFields?: boolean;
    usedLinksToFieldsOnly?: boolean;
  };
  Element: HTMLElement;
  Blocks: {
    default: [fields: FieldInfo[]];
  };
}

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

  get fields(): FieldInfo[] {
    const instanceFields = getFields(this.args.instance.constructor, {
      includeComputeds: this.args.showComputedFields ?? false,
      usedLinksToFieldsOnly: this.args.usedLinksToFieldsOnly ?? false,
    });

    return Object.keys(instanceFields).map((fieldName) => {
      const fieldInfo = instanceFields[fieldName];
      const fieldValue = (this.args.instance as any)[fieldName];
      const fieldComponent = (this.fieldsProxy as any)[
        fieldName
      ] as BoxComponent;

      return {
        name: fieldName,
        fieldType: fieldInfo.fieldType,
        value: fieldValue,
        component: fieldComponent,
      };
    });
  }

  getFieldComponent(fieldName: string): BoxComponent {
    return (this.fieldsProxy as any)[fieldName] as BoxComponent;
  }

  getFieldValue(fieldName: string) {
    return (this.args.instance as any)[fieldName];
  }

  getFieldInfo(fieldName: string) {
    const fields = getFields(this.args.instance.constructor, {
      includeComputeds: this.args.showComputedFields ?? false,
      usedLinksToFieldsOnly: this.args.usedLinksToFieldsOnly ?? false,
    });
    return fields[fieldName];
  }

  <template>
    <div class='field-renderer' ...attributes>
      {{yield this.fields}}
    </div>

    <style scoped>
      .field-renderer {
        display: contents;
      }
    </style>
  </template>
}

interface SingleFieldRendererSignature {
  Args: {
    instance: CardDef;
    fieldName: string;
    showComputedFields?: boolean;
    usedLinksToFieldsOnly?: boolean;
  };
  Element: HTMLElement;
  Blocks: {
    default: [fieldInfo: FieldInfo];
  };
}

export class SingleFieldRenderer extends GlimmerComponent<SingleFieldRendererSignature> {
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

  get fieldInfo(): FieldInfo {
    const fields = getFields(this.args.instance.constructor, {
      includeComputeds: this.args.showComputedFields ?? false,
      usedLinksToFieldsOnly: this.args.usedLinksToFieldsOnly ?? false,
    });
    const fieldDef = fields[this.args.fieldName];
    const fieldValue = (this.args.instance as any)[this.args.fieldName];
    const fieldComponent = (this.fieldsProxy as any)[
      this.args.fieldName
    ] as BoxComponent;

    return {
      name: this.args.fieldName,
      fieldType: fieldDef.fieldType,
      value: fieldValue,
      component: fieldComponent,
    };
  }

  <template>
    {{yield this.fieldInfo}}
  </template>
}
