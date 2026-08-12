import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import {
  DefaultFormatsContextName,
  isBaseDefInstance,
  isCardInstance,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import BoxelExecutionRenderer from '@cardstack/host/components/boxel-execution-renderer';

import type {
  BaseDef,
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
  /**
   * Main's `determineFormats` rule (field-component.gts): a computed field
   * never renders its editor — in an edit cascade it renders embedded.
   */
  isComputed?: boolean;
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
 * the `data-boxel-card-id`/`data-test-card` attributes. In this
 * architecture that container is the renderer's own slot root, which
 * stamps the contract for root and nested renders alike; this portal
 * contributes the field identity (`@fieldType`/`@fieldName`) that
 * classifies a nested entry.
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
  /**
   * A trusted Base component is available only for terminal relationship
   * failures. Base owns the broken-link visual contract; the portal still
   * owns every present authored value, so authored templates always re-enter
   * the execution router rather than leaking through Direct rendering.
   */
  static readBrokenComponent: (() => PortalComponent | undefined) | undefined;
  static isBroken: (() => boolean) | undefined;
  static readItems: (() => PortalComponent[]) | undefined;

  @consume(DefaultFormatsContextName)
  declare private defaultFormats: FieldFormats | undefined;

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

  private get brokenComponent(): PortalComponent | undefined {
    let constructor = this.constructor as typeof BoxelFieldPortal;
    return constructor.isBroken?.()
      ? constructor.readBrokenComponent?.()
      : undefined;
  }

  private get items(): PortalComponent[] | undefined {
    return (this.constructor as typeof BoxelFieldPortal).readItems?.();
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
    // Card-ness selects the cascade axis for the plural case too: main's
    // `linksToMany` items render in the CARD axis (`defaultFormats.cardDef`,
    // links-to-many-component.gts), not the field axis.
    // Relationship fields are card-valued by declaration even while a
    // missing target is represented by a terminal sentinel rather than a
    // CardDef instance. Deriving this only from the momentary value would
    // incorrectly switch a broken link from the card-format cascade to the
    // FieldDef cascade at exactly the point the placeholder takes over.
    let rendersCards =
      this.fieldType === 'linksTo' ||
      this.fieldType === 'linksToMany' ||
      (this.boxel
        ? isCardInstance(this.boxel)
        : Boolean(this.boxels?.every((instance) => isCardInstance(instance))));
    let defaults = this.defaultFormats ?? {
      cardDef: 'isolated',
      fieldDef: 'embedded',
    };
    let format =
      this.args.format ?? (rendersCards ? defaults.cardDef : defaults.fieldDef);
    // Main's `determineFormats`: a computed FIELD never renders in edit —
    // applied after any author-named format, exactly as main applies it to
    // the resolved result.
    if (!rendersCards && this.fieldMeta?.isComputed && format === 'edit') {
      return 'embedded';
    }
    return format;
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
    {{! RP-11.5: the ElementTracker registration and card data attributes are
      stamped by the renderer on its own slot root (the one registration
      site, shared with root renders); this portal contributes the field
      identity overlays classify entries by. }}
    {{#if this.brokenComponent}}
      <this.brokenComponent @format={{this.format}} ...attributes />
    {{else if this.items}}
      <div
        class='plural-field {{this.fieldType}}-field'
        data-test-plural-view-field={{this.fieldName}}
        data-test-plural-view={{this.fieldType}}
        data-test-plural-view-format={{this.format}}
        ...attributes
      >
        {{#each this.items as |Item|}}
          <div class='{{this.fieldType}}-itemContainer'>
            <Item @format={{this.format}} />
          </div>
        {{/each}}
      </div>
    {{else if this.boxel}}
      <BoxelExecutionRenderer
        @card={{this.boxel}}
        @format={{this.format}}
        @displayContainer={{false}}
        @relativeTo={{this.relativeTo}}
        @set={{this.write}}
        @fieldType={{this.fieldType}}
        @fieldName={{this.fieldName}}
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
          @fieldType={{this.fieldType}}
          @fieldName={{this.fieldName}}
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
  options: {
    readBrokenComponent?: () => PortalComponent | undefined;
    isBroken?: () => boolean;
    readItems?: () => PortalComponent[];
  } = {},
): PortalComponent {
  return class extends BoxelFieldPortal {
    static read = read;
    static write = write;
    static relativeTo = relativeTo;
    static fieldMeta = fieldMeta;
    static readBrokenComponent = options.readBrokenComponent;
    static isBroken = options.isBroken;
    static readItems = options.readItems;
  } as unknown as PortalComponent;
}

export function createBoxelFieldPortal(
  read: () => unknown,
  relativeTo?: RealmResourceIdentifier,
  fieldMeta?: PortalFieldMeta,
  write?: (value: unknown) => void,
  relationship?: {
    isBroken(index: number): boolean;
    component(index: number): PortalComponent | undefined;
  },
): PortalComponent {
  // Plurality is a property of the FIELD (its declared kind), never of a
  // value captured at creation time — a `containsMany` that is momentarily
  // empty is still plural, and a live `read()` may legally change length on
  // every render.
  if (
    fieldMeta?.fieldType !== 'containsMany' &&
    fieldMeta?.fieldType !== 'linksToMany'
  ) {
    return createPortalClass(read, relativeTo, fieldMeta, write, {
      isBroken: relationship ? () => relationship.isBroken(0) : undefined,
      readBrokenComponent: relationship
        ? () => relationship.component(0)
        : undefined,
    });
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
      {
        isBroken: relationship ? () => relationship.isBroken(index) : undefined,
        readBrokenComponent: relationship
          ? () => relationship.component(index)
          : undefined,
      },
    );
    itemPortals.set(index, portal);
    return portal;
  };
  let itemPortalsInOrder = (): PortalComponent[] =>
    currentArray().map((_entry, index) => itemPortalFor(index)!);

  let target = createPortalClass(read, relativeTo, fieldMeta, write, {
    readItems: itemPortalsInOrder,
  });

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
