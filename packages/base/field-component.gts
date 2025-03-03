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
  FieldFormats,
} from './card-api';
import {
  CardContextName,
  DefaultFormatsContextName,
  PermissionsContextName,
  getField,
  Loader,
  type CodeRef,
  type Permissions,
  ResolvedCodeRef,
} from '@cardstack/runtime-common';
import type { ComponentLike } from '@glint/template';
import { CardContainer } from '@cardstack/boxel-ui/components';
import Modifier from 'ember-modifier';
import { isEqual } from 'lodash';
import { initSharedState } from './shared-state';
import { and, eq, not } from '@cardstack/boxel-ui/helpers';
import { consume, provide } from 'ember-provide-consume-context';
import Component from '@glimmer/component';

export interface BoxComponentSignature {
  Element: HTMLElement; // This may not be true for some field components, but it's true more often than not
  Args: {
    Named: {
      format?: Format;
      displayContainer?: boolean;
      typeConstraint?: ResolvedCodeRef;
    };
  };
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
  commandContext: undefined,
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
  Blocks: { default: [FieldFormats] };
}

export class DefaultFormatsConsumer extends Component<DefaultFormatConsumerSignature> {
  @consume(DefaultFormatsContextName) declare defaultFormats:
    | FieldFormats
    | undefined;

  get effectiveDefaultFormats(): FieldFormats {
    return this.defaultFormats ?? { cardDef: 'isolated', fieldDef: 'embedded' };
  }

  <template>
    {{yield this.effectiveDefaultFormats}}
  </template>
}

interface DefaultFormatsProviderSignature {
  Args: { value: FieldFormats };
  Blocks: { default: [] };
}

export class DefaultFormatsProvider extends Component<DefaultFormatsProviderSignature> {
  @provide(DefaultFormatsContextName)
  get defaultFormats() {
    return this.args.value;
  }
}

interface PermissionsConsumerSignature {
  Blocks: { default: [Permissions | undefined] };
}

export class PermissionsConsumer extends Component<PermissionsConsumerSignature> {
  @consume(PermissionsContextName) declare permissions: Permissions | undefined;

  <template>
    {{yield this.permissions}}
  </template>
}

const componentCache = initSharedState(
  'componentCache',
  () =>
    new WeakMap<
      Box<BaseDef>,
      { component: BoxComponent; cardOrField: typeof BaseDef }
    >(),
);

export function getBoxComponent(
  cardOrField: typeof BaseDef,
  model: Box<BaseDef>,
  field: Field | undefined,
  opts?: { componentCodeRef?: CodeRef },
): BoxComponent {
  // the componentCodeRef is only set on the server during card prerendering,
  // it should have no effect on component stability
  let stable = componentCache.get(model);
  if (stable?.cardOrField === cardOrField) {
    return stable.component;
  }
  function determineFormats(
    userFormat: Format | undefined,
    defaultFormats: FieldFormats,
  ): FieldFormats {
    let availableFormats = formats;
    let result: FieldFormats =
      userFormat && availableFormats.includes(userFormat)
        ? { fieldDef: userFormat, cardDef: userFormat }
        : defaultFormats;
    return result;
  }

  let internalFieldsCache:
    | { fields: FieldsTypeFor<BaseDef>; format: Format }
    | undefined;

  function lookupComponents(effectiveFormat: Format): {
    CardOrFieldFormatComponent: BaseDefComponent;
    fields: FieldsTypeFor<BaseDef>;
  } {
    let currentCardOrFieldClass: typeof BaseDef | null = cardOrField;
    let effectiveCardOrFieldComponent: typeof BaseDef | undefined;
    while (
      opts?.componentCodeRef &&
      !effectiveCardOrFieldComponent &&
      currentCardOrFieldClass
    ) {
      let ref = Loader.identify(currentCardOrFieldClass);
      if (isEqual(ref, opts.componentCodeRef)) {
        effectiveCardOrFieldComponent = currentCardOrFieldClass;
        break;
      }
      currentCardOrFieldClass = Reflect.getPrototypeOf(
        currentCardOrFieldClass,
      ) as typeof BaseDef | null;
    }
    if (!effectiveCardOrFieldComponent) {
      effectiveCardOrFieldComponent = cardOrField;
    }

    let fields: FieldsTypeFor<BaseDef>;
    if (internalFieldsCache?.format === effectiveFormat) {
      fields = internalFieldsCache.fields;
    } else {
      fields = fieldsComponentsFor({}, model);
      internalFieldsCache = { fields, format: effectiveFormat };
    }
    return {
      // note that Fields do not have an "isolated" format--only Cards do,
      // the "any" cast is hiding that type warning
      CardOrFieldFormatComponent: (effectiveCardOrFieldComponent as any)[
        effectiveFormat
      ],
      fields,
    };
  }

  let component: TemplateOnlyComponent<{
    Element: HTMLElement;
    Args: {
      format?: Format;
      displayContainer?: boolean;
      typeConstraint?: ResolvedCodeRef;
    };
  }> = <template>
    <CardContextConsumer as |context|>
      <PermissionsConsumer as |permissions|>
        <DefaultFormatsConsumer as |defaultFormats|>
          {{#let
            (determineFormats @format defaultFormats)
            as |effectiveFormats|
          }}
            {{#let
              (lookupComponents
                (if
                  (isCard model.value)
                  effectiveFormats.cardDef
                  effectiveFormats.fieldDef
                )
              )
              (if (eq @displayContainer false) false true)
              as |c displayContainer|
            }}
              {{#if (isCard model.value)}}
                {{#let model.value as |card|}}
                  <DefaultFormatsProvider
                    @value={{defaultFieldFormats effectiveFormats.cardDef}}
                  >
                    <CardContainer
                      @displayBoundaries={{displayContainer}}
                      class='field-component-card
                        {{effectiveFormats.cardDef}}-format display-container-{{displayContainer}}'
                      {{context.cardComponentModifier
                        card=card
                        format=effectiveFormats.cardDef
                        fieldType=field.fieldType
                        fieldName=field.name
                      }}
                      data-test-card={{card.id}}
                      data-test-card-format={{effectiveFormats.cardDef}}
                      data-test-field-component-card
                      {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                      ...attributes
                    >
                      <c.CardOrFieldFormatComponent
                        @cardOrField={{cardOrField}}
                        @model={{card}}
                        @fields={{c.fields}}
                        @format={{effectiveFormats.cardDef}}
                        @set={{model.set}}
                        @fieldName={{model.name}}
                        @context={{context}}
                        @canEdit={{and
                          (not field.computeVia)
                          permissions.canWrite
                        }}
                        @typeConstraint={{@typeConstraint}}
                      />
                    </CardContainer>
                  </DefaultFormatsProvider>
                {{/let}}
              {{else if (isCompoundField model.value)}}
                <DefaultFormatsProvider
                  @value={{defaultFieldFormats effectiveFormats.fieldDef}}
                >
                  <div
                    class='compound-field {{effectiveFormats.fieldDef}}-format'
                    data-test-compound-field-format={{effectiveFormats.fieldDef}}
                    data-test-compound-field-component
                    {{! @glint-ignore  Argument of type 'unknown' is not assignable to parameter of type 'Element'}}
                    ...attributes
                  >
                    <c.CardOrFieldFormatComponent
                      @cardOrField={{cardOrField}}
                      @model={{model.value}}
                      @fields={{c.fields}}
                      @format={{effectiveFormats.fieldDef}}
                      @set={{model.set}}
                      @fieldName={{model.name}}
                      @context={{context}}
                      @canEdit={{and
                        (not field.computeVia)
                        permissions.canWrite
                      }}
                    />
                  </div>
                </DefaultFormatsProvider>
              {{else}}
                <DefaultFormatsProvider
                  @value={{defaultFieldFormats effectiveFormats.fieldDef}}
                >
                  <c.CardOrFieldFormatComponent
                    @cardOrField={{cardOrField}}
                    @model={{model.value}}
                    @fields={{c.fields}}
                    @format={{effectiveFormats.fieldDef}}
                    @set={{model.set}}
                    @fieldName={{model.name}}
                    @context={{context}}
                    @canEdit={{and (not field.computeVia) permissions.canWrite}}
                    ...attributes
                  />
                </DefaultFormatsProvider>
              {{/if}}
            {{/let}}
          {{/let}}
        </DefaultFormatsConsumer>
      </PermissionsConsumer>
    </CardContextConsumer>
    <style scoped>
      .field-component-card.isolated-format {
        height: 100%;
      }

      .field-component-card.fitted-format {
        /*
          The cards themselves need to be in charge of the styles within the card boundary
          in order for the container queries to make sense--otherwise we need to do style
          math to figure out what the actual breakpoints are. please resist the urge to add
          padding or anything that alters the geometry inside of the card boundary.

          we need to use height 100% because the container query for embedded cards only
          works if we use up all the space horizontally and vertically that is available
          to the card since some of our queries are height queries
        */
        height: 65px;
        container-name: fitted-card;
        container-type: size;
        overflow: hidden;
      }

      .field-component-card.embedded-format {
        /*
          The cards themselves need to be in charge of the styles within the card boundary
          in order for the container queries to make sense--otherwise we need to do style
          math to figure out what the actual breakpoints are. please resist the urge to add
          padding or anything that alters the geometry inside of the card boundary.
        */
        container-name: embedded-card;
        container-type: inline-size;
        overflow: hidden;
      }

      .field-component-card.atom-format.display-container-false {
        display: contents;
      }
      .field-component-card.atom-format.display-container-true {
        display: inline-block;
        width: auto;
        height: auto;
        padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
      }
      .field-component-card.atom-format > :deep(*) {
        vertical-align: middle;
      }
      .compound-field.atom-format {
        display: inline;
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
  stable = {
    component: externalFields as unknown as typeof component,
    cardOrField: cardOrField,
  };

  componentCache.set(model, stable);
  return stable.component;
}

function defaultFieldFormats(containingFormat: Format): FieldFormats {
  switch (containingFormat) {
    case 'edit':
      return { fieldDef: 'edit', cardDef: 'edit' };
    case 'isolated':
    case 'fitted':
    case 'embedded':
      return { fieldDef: 'embedded', cardDef: 'fitted' };
    case 'atom':
      return { fieldDef: 'atom', cardDef: 'atom' };
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
      if (
        field.fieldType === 'linksToMany' ||
        field.fieldType === 'containsMany'
      ) {
        let stable = stableComponents.get(property);
        if (stable) {
          return stable;
        } else {
          stableComponents.set(property, result);
        }
      }
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
