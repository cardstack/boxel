import Component from '@glimmer/component';

import Modifier from 'ember-modifier';
import { consume } from 'ember-provide-consume-context';

import {
  CardContextName,
  DefaultFormatsContextName,
  isBaseDefInstance,
  isCardInstance,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import BoxelExecutionRenderer from '@cardstack/host/components/boxel-execution-renderer';

import type {
  BaseDef,
  CardContext,
  CardDef,
  FieldFormats,
  FieldType,
  Format,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    format?: Format;
  };
}

type PortalComponent = ComponentLike<Signature>;

/** What the Host knows about the field this portal renders. */
export interface PortalFieldMeta {
  fieldType: FieldType | undefined;
  fieldName: string | undefined;
}

/**
 * Matches `DEFAULT_CARD_CONTEXT`'s no-op in `@cardstack/base`: when no
 * operator-mode context provides a real `cardComponentModifier`, tracking
 * silently registers nothing.
 */
class NoOpModifier extends Modifier<{
  Args: { Named: Record<string, unknown> };
}> {
  modify() {}
}

function cardIdOf(instance: BaseDef | undefined): string | undefined {
  return instance && isCardInstance(instance)
    ? ((instance as CardDef).id as string | undefined)
    : undefined;
}

/**
 * Host-owned portal for a field whose renderer is authored outside Base.
 *
 * The live value never enters a Capsule or Sandbox. This Host component is
 * the narrow invocation capability placed in `@fields`; nested Boxels cross
 * the same execution router as a top-level card, while non-Boxel values are
 * represented as inert text.
 *
 * RP-11.5: on main, every nested card render passes through
 * `field-component.gts`, whose `CardContainer` carries the operator-mode
 * DOM contract — the injected `cardComponentModifier` (ElementTracker
 * registration, which is what overlays/adorn discover cards through) and
 * the `data-boxel-card-id`/`data-test-card` attributes. This portal
 * replaces that chrome for authored fields, so it must re-stamp the same
 * contract on its rendered root or every overlay-eligible nested card
 * silently disappears from operator mode.
 */
class BoxelFieldPortal extends Component<Signature> {
  /**
   * A PATH, not a captured value — main's `Box` holds (instance, fieldName)
   * and resolves the value per render, which is the entire reason N views of
   * one card stay in sync there (RP-20.2). This thunk is that path expressed
   * through the portal boundary: every render re-reads the canonical
   * instance (a tracked read — the caller composes in the instance's version
   * cell), so a reorder, splice, or save echo re-renders the portal in place
   * instead of freezing it at creation-time state.
   */
  static read: () => unknown;
  /**
   * Main's `Box.set` for this field, when the Host grants it: assigns the
   * canonical instance's field, which funnels through RP-9.2's one setField
   * path (notify subscribers → autosave). Absent for computed fields.
   */
  static write: ((value: unknown) => void) | undefined;
  static relativeTo: RealmResourceIdentifier | undefined;
  static fieldMeta: PortalFieldMeta | undefined;

  @consume(DefaultFormatsContextName)
  declare private defaultFormats: FieldFormats | undefined;

  @consume(CardContextName)
  declare private cardContext: CardContext | undefined;

  private get value(): unknown {
    return (this.constructor as typeof BoxelFieldPortal).read();
  }

  private get write(): ((value: unknown) => void) | undefined {
    return (this.constructor as typeof BoxelFieldPortal).write;
  }

  private get relativeTo(): RealmResourceIdentifier | undefined {
    return (this.constructor as typeof BoxelFieldPortal).relativeTo;
  }

  private get fieldMeta(): PortalFieldMeta | undefined {
    return (this.constructor as typeof BoxelFieldPortal).fieldMeta;
  }

  private get fieldType(): FieldType | undefined {
    return this.fieldMeta?.fieldType;
  }

  private get fieldName(): string | undefined {
    return this.fieldMeta?.fieldName;
  }

  private get boxel(): BaseDef | undefined {
    return isBaseDefInstance(this.value) ? this.value : undefined;
  }

  private get boxels(): BaseDef[] | undefined {
    return Array.isArray(this.value) && this.value.every(isBaseDefInstance)
      ? this.value
      : undefined;
  }

  private get format(): Format {
    if (this.args.format) {
      return this.args.format;
    }
    let defaults = this.defaultFormats ?? {
      cardDef: 'isolated',
      fieldDef: 'embedded',
    };
    return this.boxel && isCardInstance(this.boxel)
      ? defaults.cardDef
      : defaults.fieldDef;
  }

  /**
   * Real tracking only for card instances — main never registers FieldDef
   * compounds with the ElementTracker either, and an entry without a
   * card identity would break overlay consumers downstream.
   */
  private get cardComponentModifier() {
    let tracksCards = this.boxel
      ? isCardInstance(this.boxel)
      : Boolean(this.boxels?.every((instance) => isCardInstance(instance)));
    return tracksCards
      ? (this.cardContext?.cardComponentModifier ?? NoOpModifier)
      : NoOpModifier;
  }

  private get cardId(): string | undefined {
    return cardIdOf(this.boxel);
  }

  private get displayValue(): string {
    if (this.value === null || this.value === undefined) {
      return '';
    }
    if (
      typeof this.value === 'string' ||
      typeof this.value === 'number' ||
      typeof this.value === 'boolean'
    ) {
      return String(this.value);
    }
    try {
      return JSON.stringify(this.value);
    } catch {
      return String(this.value);
    }
  }

  <template>
    {{#if this.boxel}}
      <BoxelExecutionRenderer
        @card={{this.boxel}}
        @format={{this.format}}
        @displayContainer={{false}}
        @relativeTo={{this.relativeTo}}
        @set={{this.write}}
        {{this.cardComponentModifier
          card=this.boxel
          format=this.format
          fieldType=this.fieldType
          fieldName=this.fieldName
        }}
        data-boxel-card-id={{this.cardId}}
        data-boxel-card-format={{this.format}}
        data-test-card={{this.cardId}}
        data-test-card-format={{this.format}}
        data-test-field-component-card
        ...attributes
      />
    {{else if this.boxels}}
      {{#each this.boxels as |boxel|}}
        <BoxelExecutionRenderer
          @card={{boxel}}
          @format={{this.format}}
          @displayContainer={{false}}
          @relativeTo={{this.relativeTo}}
          {{this.cardComponentModifier
            card=boxel
            format=this.format
            fieldType=this.fieldType
            fieldName=this.fieldName
          }}
          data-boxel-card-id={{cardIdOf boxel}}
          data-boxel-card-format={{this.format}}
          data-test-card={{cardIdOf boxel}}
          data-test-card-format={{this.format}}
          data-test-field-component-card
          ...attributes
        />
      {{/each}}
    {{else}}
      <span class='boxel-field-portal-value' ...attributes>
        {{this.displayValue}}
      </span>
    {{/if}}
  </template>
}

function createPortalClass(
  read: () => unknown,
  relativeTo: RealmResourceIdentifier | undefined,
  fieldMeta: PortalFieldMeta | undefined,
  write: ((value: unknown) => void) | undefined,
): PortalComponent {
  return class extends BoxelFieldPortal {
    static read = read;
    static write = write;
    static relativeTo = relativeTo;
    static fieldMeta = fieldMeta;
  } as unknown as PortalComponent;
}

export function createBoxelFieldPortal(
  read: () => unknown,
  relativeTo?: RealmResourceIdentifier,
  fieldMeta?: PortalFieldMeta,
  write?: (value: unknown) => void,
): PortalComponent {
  let target = createPortalClass(read, relativeTo, fieldMeta, write);

  // Plurality is a property of the FIELD (its declared kind), never of a
  // value captured at creation time — a `containsMany` that is momentarily
  // empty is still plural, and a live `read()` may legally change length on
  // every render.
  if (
    fieldMeta?.fieldType !== 'containsMany' &&
    fieldMeta?.fieldType !== 'linksToMany'
  ) {
    return target;
  }

  // RP-3.4: "`@fields` of a plural field is array-like (iterable, length,
  // index)." Main's `linksToMany`/`containsMany` field component
  // (`getLinksToManyComponent`/`getContainsManyComponent` in
  // `@cardstack/base`) is a Proxy over the plural component: directly
  // rendering it (`<@fields.reviewers />`) shows every item via the
  // component's own template (unchanged below), while `Symbol.iterator`,
  // `length`, and a numeric-string property yield the per-item component —
  // so both `{{#each @fields.reviewers as |Item|}}` and
  // `(get @fields.reviewers index)` resolve to the same per-item render an
  // authored card composes. Reproduce that contract here so an authored
  // Boxel sees identical behavior whether its plural field portal is a
  // trusted Base component or this Host-owned one.
  let currentArray = (): unknown[] => {
    let value = read();
    return Array.isArray(value) ? value : [];
  };
  // Cached per INDEX — a stable component identity per position is exactly
  // main's per-index Box child (`children()` in card-api's Box), so an item
  // whose content changes re-renders in place while an item that merely
  // moved re-reads its new occupant through the index path.
  let itemPortals = new Map<number, PortalComponent>();
  let itemPortalFor = (index: number): PortalComponent | undefined => {
    if (index < 0 || index >= currentArray().length) {
      return undefined;
    }
    let existing = itemPortals.get(index);
    if (existing) {
      return existing;
    }
    let portal = createPortalClass(
      () => currentArray()[index],
      relativeTo,
      fieldMeta,
      write
        ? (value) => {
            // RP-9.3: `containsMany` mutates the watched array in place —
            // the same write main's per-index Box.set performs.
            let array = read();
            if (Array.isArray(array)) {
              array[index] = value;
            }
          }
        : undefined,
    );
    itemPortals.set(index, portal);
    return portal;
  };
  let itemPortalsInOrder = (): PortalComponent[] =>
    currentArray().map((_entry, index) => itemPortalFor(index)!);

  return new Proxy(target, {
    get(proxyTarget, property, received) {
      if (property === Symbol.iterator) {
        return itemPortalsInOrder()[Symbol.iterator];
      }
      if (property === 'length') {
        return currentArray().length;
      }
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        return itemPortalFor(Number(property));
      }
      return Reflect.get(proxyTarget, property, received);
    },
    getPrototypeOf() {
      // Ember's template lookup needs the proxy to appear to inherit from
      // the real component class it wraps (the same reason
      // `getLinksToManyComponent`/`getContainsManyComponent` do this).
      return target;
    },
  }) as unknown as PortalComponent;
}
