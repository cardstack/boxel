import { Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import IdIcon from '@cardstack/boxel-icons/id';

/**
 * The identifier a membership program prints on the card — stable, human-
 * readable, quoted over the phone. It is a label, not a key: the card's id
 * is the reference other cards link by; the member number is what the
 * member sees.
 *
 * Rendering is monospaced so the digit groups line up in lists and read
 * unambiguously (no 0/O squint).
 */
export default class MemberNumberField extends StringField {
  static displayName = 'Member Number';
  static icon = IdIcon;

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span class='member-number'>{{if @model @model '—'}}</span>
      <style scoped>
        .member-number {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-sm);
          letter-spacing: 0.04em;
          color: var(--foreground, var(--boxel-dark));
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='member-number'>{{@model}}</span>
      <style scoped>
        .member-number {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: var(--boxel-font-size-xs);
          letter-spacing: 0.04em;
        }
      </style>
    </template>
  };
}

/**
 * The common `PREFIX-YYYY-SEQUENCE` shape. Sequencing itself is the caller's
 * problem — a realm has no global counter, so the enrolling command decides
 * where the next number comes from (a count query, an imported roll, a
 * random block) and this only formats it consistently.
 */
export function formatMemberNumber(
  prefix: string,
  year: number,
  sequence: number,
  width = 8,
): string {
  return `${prefix}-${year}-${String(sequence).padStart(width, '0')}`;
}
