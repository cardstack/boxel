import type { TemplateOnlyComponent } from '@ember/component/template-only';
import {
  type Box,
  type Field,
  type Format,
  type FieldsTypeFor,
  type BaseDef,
  type BaseDefComponent,
  type BaseDefConstructor,
  CardContext,
  isCard,
  isCompoundField,
  formats,
} from './card-api';
import { getField } from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { CardContainer } from '@cardstack/boxel-ui/components';
import Modifier from 'ember-modifier';
import { initSharedState } from './shared-state';
import { eq } from '@cardstack/boxel-ui/helpers';

interface BoxComponentSignature {
  Args: { Named: { format?: Format; displayContainer?: boolean } };
  Blocks: {};
}

export type BoxComponent = ComponentLike<BoxComponentSignature>;

const componentCache = initSharedState(
  'componentCache',
  () => new WeakMap<Box<BaseDef>, BoxComponent>(),
);

export function getBoxComponent(
  card: typeof BaseDef,
  defaultFormat: Format,
  model: Box<BaseDef>,
  field: Field | undefined,
  context: CardContext = {},
): BoxComponent {
  let stable = componentCache.get(model);
  if (stable) {
    return stable;
  }
  let internalFieldsCache:
    | { fields: FieldsTypeFor<BaseDef>; format: Format }
    | undefined;

  // cardComponentModifier, when provided, is used for the host environment to get access to card's rendered elements
  let cardComponentModifier =
    context.cardComponentModifier ??
    class NoOpModifier extends Modifier<any> {
      modify() {}
    };

  function lookupFormat(userFormat: Format | undefined): {
    Implementation: BaseDefComponent;
    fields: FieldsTypeFor<BaseDef>;
    format: Format;
  } {
    let format: Format;
    let availableFormats = formats;
    let effectiveDefaultFormat = defaultFormat;
    if (field?.computeVia) {
      availableFormats = formats.filter(
        (f) => !['isolated', 'edit'].includes(f),
      );
      if (!availableFormats.includes(effectiveDefaultFormat)) {
        effectiveDefaultFormat = 'embedded';
      }
    }
    format =
      userFormat && availableFormats.includes(userFormat)
        ? userFormat
        : effectiveDefaultFormat;

    let fields: FieldsTypeFor<BaseDef>;
    if (internalFieldsCache?.format === format) {
      fields = internalFieldsCache.fields;
    } else {
      fields = fieldsComponentsFor(
        {},
        model,
        defaultFieldFormat(format),
        context,
      );
      internalFieldsCache = { fields, format };
    }

    return {
      Implementation: (card as any)[format],
      fields,
      format,
    };
  }

  let component: TemplateOnlyComponent<{
    Args: { format?: Format; displayContainer?: boolean };
  }> = <template>
    {{#let
      (lookupFormat @format) (if (eq @displayContainer false) false true)
      as |f displayContainer|
    }}
      {{#if (isCard model.value)}}
        <CardContainer
          @displayBoundaries={{displayContainer}}
          class='field-component-card
            {{f.format}}-format display-container-{{displayContainer}}'
          {{cardComponentModifier
            card=model.value
            format=f.format
            fieldType=field.fieldType
            fieldName=field.name
          }}
          data-test-card-format={{f.format}}
          data-test-field-component-card
          {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
          ...attributes
        >
          <f.Implementation
            @cardOrField={{card}}
            @model={{model.value}}
            @fields={{f.fields}}
            @format={{f.format}}
            @displayContainer={{@displayContainer}}
            @set={{model.set}}
            @fieldName={{model.name}}
            @context={{context}}
          />
        </CardContainer>
      {{else if (isCompoundField model.value)}}
        <div
          data-test-compound-field-format={{f.format}}
          data-test-compound-field-component
          {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
          ...attributes
        >
          <f.Implementation
            @cardOrField={{card}}
            @model={{model.value}}
            @fields={{f.fields}}
            @format={{f.format}}
            @displayContainer={{@displayContainer}}
            @set={{model.set}}
            @fieldName={{model.name}}
            @context={{context}}
          />
        </div>
      {{else}}
        <f.Implementation
          @cardOrField={{card}}
          @model={{model.value}}
          @fields={{f.fields}}
          @format={{f.format}}
          @displayContainer={{@displayContainer}}
          @set={{model.set}}
          @fieldName={{model.name}}
          @context={{context}}
        />
      {{/if}}
    {{/let}}
    <style>
      .field-component-card.embedded-format {
        padding: var(--boxel-sp);
      }

      .field-component-card.atom-format {
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .field-component-card.atom-format.display-container-true {
        padding: 4px var(--boxel-sp-sm);
        background-color: var(--boxel-light);
      }
    </style>
  </template>;

  // when viewed from *outside*, our component is both an invokable component
  // and a proxy that makes our fields available for nested invocation, like
  // <@fields.us.deeper />.
  //
  // It would be possible to use `externalFields` in place of `internalFields` above,
  // avoiding the need for two separate Proxies. But that has the uncanny property of
  // making `<@fields />` be an infinite recursion.
  let externalFields = fieldsComponentsFor(
    component,
    model,
    defaultFieldFormat(defaultFormat),
    context,
  );

  // This cast is safe because we're returning a proxy that wraps component.
  stable = externalFields as unknown as typeof component;
  componentCache.set(model, stable);
  return stable;
}

function defaultFieldFormat(format: Format): Format {
  switch (format) {
    case 'edit':
      return 'edit';
    case 'isolated':
    case 'embedded':
      return 'embedded';
    case 'atom':
      return 'atom';
  }
}

function fieldsComponentsFor<T extends BaseDef>(
  target: object,
  model: Box<T>,
  defaultFormat: Format,
  context?: CardContext,
): FieldsTypeFor<T> {
  // This is a cache of the fields we've already created components for
  // so that they do not get recreated
  let stableComponents = new Map<string, BoxComponent>();

  return new Proxy(target, {
    get(target, property, received) {
      if (
        typeof property === 'symbol' ||
        model == null ||
        model.value == null
      ) {
        // don't handle symbols or nulls
        return Reflect.get(target, property, received);
      }

      let stable = stableComponents.get(property);
      if (stable) {
        return stable;
      }

      let modelValue = model.value as T; // TS is not picking up the fact we already filtered out nulls and undefined above
      let maybeField: Field<BaseDefConstructor> | undefined = getField(
        modelValue.constructor,
        property,
      );
      if (!maybeField) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.get(target, property, received);
      }
      let field = maybeField;

      let result = field.component(
        model as unknown as Box<BaseDef>,
        defaultFormat,
        context,
      );
      stableComponents.set(property, result);
      return result;
    },
    getPrototypeOf() {
      // This is necessary for Ember to be able to locate the template associated
      // with a proxied component. Our Proxy object won't be in the template WeakMap,
      // but we can pretend our Proxy object inherits from the true component, and
      // Ember's template lookup respects inheritance.
      return target;
    },
    ownKeys(target) {
      let keys = Reflect.ownKeys(target);
      for (let name in model.value) {
        let field = getField(model.value.constructor, name);
        if (field) {
          keys.push(name);
        }
      }
      return keys;
    },
    getOwnPropertyDescriptor(target, property) {
      if (
        typeof property === 'symbol' ||
        model == null ||
        model.value == null
      ) {
        // don't handle symbols, undefined, or nulls
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      let field = getField(model.value.constructor, property);
      if (!field) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.getOwnPropertyDescriptor(target, property);
      }
      // found field: fields are enumerable properties
      return {
        enumerable: true,
        writable: true,
        configurable: true,
      };
    },
  }) as any;
}

export function getPluralViewComponent(
  model: Box<BaseDef[]>,
  field: Field<typeof BaseDef>,
  format: Format,
  cardTypeFor: (
    field: Field<typeof BaseDef>,
    boxedElement: Box<BaseDef>,
  ) => typeof BaseDef,
  context?: CardContext,
): BoxComponent {
  let getComponents = () =>
    model.children.map((child) =>
      getBoxComponent(cardTypeFor(field, child), format, child, field, context),
    ); // Wrap the the components in a function so that the template is reactive to changes in the model (this is essentially a helper)
  let pluralViewComponent: TemplateOnlyComponent<BoxComponentSignature> =
    <template>
      {{#let (if @format @format format) as |format|}}
        <div
          class='plural-field
            {{field.fieldType}}-field
            {{format}}-format
            {{unless model.children.length "empty"}}'
          data-test-plural-view={{field.fieldType}}
          data-test-plural-view-format={{format}}
        >
          {{#each (getComponents) as |Item i|}}
            <div data-test-plural-view-item={{i}}>
              <Item @format={{format}} />
            </div>
          {{/each}}
        </div>
      {{/let}}
      <style>
        .linksToMany-field.embedded-format > div + div {
          margin-top: var(--boxel-sp);
        }
        .linksToMany-field.atom-format {
          display: flex;
          gap: var(--boxel-sp-sm);
          padding: var(--boxel-sp-sm);
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
        }
        .containsMany-field.atom-format {
          padding: var(--boxel-sp-sm);
          background-color: var(--boxel-100);
          border: none !important;
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>;
  return new Proxy(pluralViewComponent, {
    get(target, property, received) {
      // proxying the bare minimum of an Array in order to render within a
      // template. add more getters as necessary...
      let components = getComponents();

      if (property === Symbol.iterator) {
        return components[Symbol.iterator];
      }
      if (property === 'length') {
        return components.length;
      }
      if (typeof property === 'string' && property.match(/\d+/)) {
        return components[parseInt(property)];
      }
      return Reflect.get(target, property, received);
    },
    getPrototypeOf() {
      // This is necessary for Ember to be able to locate the template associated
      // with a proxied component. Our Proxy object won't be in the template WeakMap,
      // but we can pretend our Proxy object inherits from the true component, and
      // Ember's template lookup respects inheritance.
      return pluralViewComponent;
    },
  });
}
