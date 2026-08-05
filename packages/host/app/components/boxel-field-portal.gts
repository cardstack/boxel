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
  return class extends BoxelFieldPortal {
    static value = value;
    static relativeTo = relativeTo;
  } as unknown as PortalComponent;
}
