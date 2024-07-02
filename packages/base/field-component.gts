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
import {
  CardContextName,
  DefaultFormatContextName,
  RealmSession,
  RealmSessionContextName,
  getField,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { CardContainer } from '@cardstack/boxel-ui/components';
import Modifier from 'ember-modifier';
import { initSharedState } from './shared-state';
import { eq } from '@cardstack/boxel-ui/helpers';
import { consume, provide } from 'ember-provide-consume-context';
import Component from '@glimmer/component';

export interface BoxComponentSignature {
  Args: { Named: { format?: Format; displayContainer?: boolean } };
  Blocks: {};
}

export type BoxComponent = ComponentLike<BoxComponentSignature>;

interface CardContextConsumerSignature {
  Blocks: { default: [CardContext] };
}

// cardComponentModifier, when provided, is used for the host environment to get access to card's rendered elements
const DEFAULT_CARD_CONTEXT = {
  cardComponentModifier: class NoOpModifier extends Modifier<any> {
    modify() {}
  },
  actions: undefined,
};

export class CardContextConsumer extends Component<CardContextConsumerSignature> {
  @consume(CardContextName) declare dynamicCardContext: CardContext;

  get context(): CardContext {
    return {
      ...DEFAULT_CARD_CONTEXT,
      ...this.dynamicCardContext,
    };
  }

  <template>
    {{yield this.context}}
  </template>
}

interface DefaultFormatConsumerSignature {
  Blocks: { default: [Format] };
}

export class DefaultFormatConsumer extends Component<DefaultFormatConsumerSignature> {
  @consume(DefaultFormatContextName) declare defaultFormat: Format | undefined;

  get effectiveDefaultFormat(): Format {
    return this.defaultFormat ?? 'isolated';
  }

  <template>
    {{yield this.effectiveDefaultFormat}}
  </template>
}

interface DefaultFormatProviderSignature {
  Args: { value: Format };
  Blocks: { default: [] };
}

export class DefaultFormatProvider extends Component<DefaultFormatProviderSignature> {
  @provide(DefaultFormatContextName)
  get defaultFormat() {
    return this.args.value;
  }
}

interface RealmSessionConsumerSignature {
  Blocks: { default: [RealmSession | undefined] };
}

export class RealmSessionConsumer extends Component<RealmSessionConsumerSignature> {
  @consume(RealmSessionContextName) declare realmSession:
    | RealmSession
    | undefined;

  <template>
    {{yield this.realmSession}}
  </template>
}

const componentCache = initSharedState(
  'componentCache',
  () => new WeakMap<Box<BaseDef>, BoxComponent>(),
);

export function getBoxComponent(
  cardOrField: typeof BaseDef,
  model: Box<BaseDef>,
  field: Field | undefined,
): BoxComponent {
  let stable = componentCache.get(model);
  if (stable) {
    return stable;
  }
  function determineFormat(
    userFormat: Format | undefined,
    defaultFormat: Format,
  ): Format {
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
    return format;
  }

  let internalFieldsCache:
    | { fields: FieldsTypeFor<BaseDef>; format: Format }
    | undefined;

  function lookupComponents(effectiveFormat: Format): {
    CardOrFieldFormatComponent: BaseDefComponent;
    fields: FieldsTypeFor<BaseDef>;
  } {
    let fields: FieldsTypeFor<BaseDef>;
    if (internalFieldsCache?.format === effectiveFormat) {
      fields = internalFieldsCache.fields;
    } else {
      fields = fieldsComponentsFor({}, model);
      internalFieldsCache = { fields, format: effectiveFormat };
    }
    return {
      CardOrFieldFormatComponent: (cardOrField as any)[effectiveFormat],
      fields,
    };
  }

  let component: TemplateOnlyComponent<{
    Args: { format?: Format; displayContainer?: boolean };
  }> = <template>
    <CardContextConsumer as |context|>
      <RealmSessionConsumer as |realmSession|>
        <DefaultFormatConsumer as |defaultFormat|>
          {{#let (determineFormat @format defaultFormat) as |effectiveFormat|}}
            {{#let
              (lookupComponents effectiveFormat)
              (if (eq @displayContainer false) false true)
              as |c displayContainer|
            }}
              <DefaultFormatProvider
                @value={{defaultFieldFormat effectiveFormat}}
              >
                {{#if (isCard model.value)}}
                  <CardContainer
                    @displayBoundaries={{displayContainer}}
                    class='field-component-card
                      {{effectiveFormat}}-format display-container-{{displayContainer}}'
                    {{context.cardComponentModifier
                      card=model.value
                      format=effectiveFormat
                      fieldType=field.fieldType
                      fieldName=field.name
                    }}
                    data-test-card-format={{effectiveFormat}}
                    data-test-field-component-card
                    {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                    ...attributes
                  >
                    <c.CardOrFieldFormatComponent
                      @cardOrField={{cardOrField}}
                      @model={{model.value}}
                      @fields={{c.fields}}
                      @format={{effectiveFormat}}
                      @set={{model.set}}
                      @fieldName={{model.name}}
                      @context={{context}}
                      @canEdit={{realmSession.canWrite}}
                    />
                  </CardContainer>
                {{else if (isCompoundField model.value)}}
                  <div
                    data-test-compound-field-format={{effectiveFormat}}
                    data-test-compound-field-component
                    {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                    ...attributes
                  >
                    <c.CardOrFieldFormatComponent
                      @cardOrField={{cardOrField}}
                      @model={{model.value}}
                      @fields={{c.fields}}
                      @format={{effectiveFormat}}
                      @set={{model.set}}
                      @fieldName={{model.name}}
                      @context={{context}}
                      @canEdit={{realmSession.canWrite}}
                    />
                  </div>
                {{else}}
                  <c.CardOrFieldFormatComponent
                    @cardOrField={{cardOrField}}
                    @model={{model.value}}
                    @fields={{c.fields}}
                    @format={{effectiveFormat}}
                    @set={{model.set}}
                    @fieldName={{model.name}}
                    @context={{context}}
                    @canEdit={{realmSession.canWrite}}
                  />
                {{/if}}
              </DefaultFormatProvider>
            {{/let}}
          {{/let}}
        </DefaultFormatConsumer>
      </RealmSessionConsumer>
    </CardContextConsumer>
    <style>
      .field-component-card.isolated-format {
        height: 100%;
      }

      .field-component-card.embedded-format {
        /*
          The cards themselves need to be in charge of the styles within the card boundary
          in order for the container queries to make sense--otherwise we need to do style 
          math to figure out what the actual breakpoints are. please resist the urge to add 
          padding, borders, etc--bascially anything that alters the geometry inside of the 
          card boundary.

          we need to use height 100% because the container query for embedded cards only
          works if we use up all the space horizontally and veritically that is available
          to the card since some of our queries are height queries
        */
        height: 100%;
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
  let externalFields = fieldsComponentsFor(component, model);

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

      let result = field.component(model as unknown as Box<BaseDef>);
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
