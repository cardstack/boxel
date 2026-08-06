import Component from '@glimmer/component';

import { consume } from 'ember-provide-consume-context';

import {
  DefaultFormatsContextName,
  isBaseDefInstance,
  isCardInstance,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import BoxelExecutionRenderer from '@cardstack/host/components/boxel-execution-renderer';

import type { BaseDef, FieldFormats, Format } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    format?: Format;
  };
}

type PortalComponent = ComponentLike<Signature>;

/**
 * Host-owned portal for a field whose renderer is authored outside Base.
 *
 * The live value never enters a Capsule or Sandbox. This Host component is
 * the narrow invocation capability placed in `@fields`; nested Boxels cross
 * the same execution router as a top-level card, while non-Boxel values are
 * represented as inert text.
 */
class BoxelFieldPortal extends Component<Signature> {
  static value: unknown;
  static relativeTo: RealmResourceIdentifier | undefined;

  @consume(DefaultFormatsContextName)
  declare private defaultFormats: FieldFormats | undefined;

  private get value(): unknown {
    return (this.constructor as typeof BoxelFieldPortal).value;
  }

  private get relativeTo(): RealmResourceIdentifier | undefined {
    return (this.constructor as typeof BoxelFieldPortal).relativeTo;
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
        ...attributes
      />
    {{else if this.boxels}}
      {{#each this.boxels as |boxel|}}
        <BoxelExecutionRenderer
          @card={{boxel}}
          @format={{this.format}}
          @displayContainer={{false}}
          @relativeTo={{this.relativeTo}}
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

export function createBoxelFieldPortal(
  value: unknown,
  relativeTo?: RealmResourceIdentifier,
): PortalComponent {
  let target = class extends BoxelFieldPortal {
    static value = value;
    static relativeTo = relativeTo;
  } as unknown as PortalComponent;

  if (!Array.isArray(value)) {
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
  let itemPortals = new Map<number, PortalComponent>();
  let itemPortalFor = (index: number): PortalComponent | undefined => {
    if (index < 0 || index >= value.length) {
      return undefined;
    }
    let existing = itemPortals.get(index);
    if (existing) {
      return existing;
    }
    let portal = createBoxelFieldPortal(value[index], relativeTo);
    itemPortals.set(index, portal);
    return portal;
  };
  let itemPortalsInOrder = (): PortalComponent[] =>
    value.map((_entry, index) => itemPortalFor(index)!);

  return new Proxy(target, {
    get(proxyTarget, property, received) {
      if (property === Symbol.iterator) {
        return itemPortalsInOrder()[Symbol.iterator];
      }
      if (property === 'length') {
        return value.length;
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
