import GlimmerComponent from '@glimmer/component';
import {
  type Box,
  type Field,
  type Format,
  type FieldsTypeFor,
  type BaseDef,
  type BaseDefComponent,
  CardContext,
  isCard,
  isCompoundField,
} from './card-api';
import { getField } from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { CardContainer } from '@cardstack/boxel-ui';
import Modifier from 'ember-modifier';

const componentCache = new WeakMap<
  Box<BaseDef>,
  ComponentLike<{ Args: {}; Blocks: {} }>
>();

export function getBoxComponent(
  card: typeof BaseDef,
  format: Format,
  model: Box<BaseDef>,
  field: Field | undefined,
  context: CardContext = {},
): ComponentLike<{ Args: {}; Blocks: {} }> {
  let stable = componentCache.get(model);
  if (stable) {
    return stable;
  }

  let Implementation: BaseDefComponent = (card as any)[format];

  // *inside* our own component, @fields is a proxy object that looks
  // up our fields on demand.
  let internalFields = fieldsComponentsFor(
    {},
    model,
    defaultFieldFormat(format),
    context,
  );

  // cardComponentModifier, when provided, is used for the host environment to get access to card's rendered elements
  let cardComponentModifier =
    context.cardComponentModifier ??
    class NoOpModifier extends Modifier<any> {
      modify() {}
    };

  let component: ComponentLike<{ Args: {}; Blocks: {} }> = <template>
    {{#if (isCard model.value)}}
      <CardContainer
        @displayBoundaries={{true}}
        class='field-component-card {{format}}-card'
        {{cardComponentModifier
          card=model.value
          format=format
          fieldType=field.fieldType
          fieldName=field.name
        }}
        data-test-field-component-card
        {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
        ...attributes
      >
        <Implementation
          @model={{model.value}}
          @fields={{internalFields}}
          @set={{model.set}}
          @fieldName={{model.name}}
          @context={{context}}
        />
      </CardContainer>
    {{else if (isCompoundField model.value)}}
      <div
        class='{{format}}-compound-field'
        data-test-compound-field-component
        {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
        ...attributes
      >
        <Implementation
          @model={{model.value}}
          @fields={{internalFields}}
          @set={{model.set}}
          @fieldName={{model.name}}
          @context={{context}}
        />
      </div>
    {{else}}
      <Implementation
        @model={{model.value}}
        @fields={{internalFields}}
        @set={{model.set}}
        @fieldName={{model.name}}
        @context={{context}}
      />
    {{/if}}
    <style>
      .field-component-card {
        padding: var(--boxel-sp);
      }

      .isolated-card {
        padding: var(--boxel-sp-xl);
      }

      .edit-card {
        padding: var(--boxel-sp-xl) var(--boxel-sp-xxl) var(--boxel-sp-xl)
          var(--boxel-sp-xl);
      }

      .atom-card {
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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
    defaultFieldFormat(format),
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
      let modelValue = model.value as T; // TS is not picking up the fact we already filtered out nulls and undefined above
      let maybeField = getField(modelValue.constructor, property);
      if (!maybeField) {
        // field doesn't exist, fall back to normal property access behavior
        return Reflect.get(target, property, received);
      }
      let field = maybeField;
      let format = getField(modelValue.constructor, property)?.computeVia
        ? 'embedded'
        : defaultFormat;
      return field.component(model as unknown as Box<BaseDef>, format, context);
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
): ComponentLike<{ Args: {}; Blocks: {} }> {
  let components = model.children.map((child) =>
    getBoxComponent(cardTypeFor(field, child), format, child, field, context),
  );
  let defaultComponent = class PluralView extends GlimmerComponent {
    <template>
      <div
        class='plural-field
          {{field.fieldType}}-field
          {{format}}-format
          {{unless model.children.length "empty"}}'
        data-test-plural-view={{field.fieldType}}
        data-test-plural-view-format={{format}}
      >
        {{#each model.children as |child i|}}
          {{#let
            (getBoxComponent
              (cardTypeFor field child) format child field context
            )
            as |Item|
          }}
            <div data-test-plural-view-item={{i}}>
              <Item />
            </div>
          {{/let}}
        {{/each}}
      </div>
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
          border: var(--boxel-border);
          border-radius: var(--boxel-border-radius);
        }
      </style>
    </template>
  };
  return new Proxy(defaultComponent, {
    get(target, property, received) {
      // proxying the bare minimum of an Array in order to render within a
      // template. add more getters as necessary...
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
      return defaultComponent;
    },
  });
}
