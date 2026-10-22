// Pretui — RecordFace: a record shown as avatar, title and meta.
import Component from '@glimmer/component';
import { Avatar } from './avatar';
import { iconFor } from '../icon-registry';
import type { PickerRecord } from '../internal/forms-picker';

// ── RecordFace ───────────────────────────────────────────────────────────
// The shared presentational row behind every record surface in this file
// (listbox option, selection pill, dueling-list option). Exported as its own
// primitive so sibling forms components render records identically.
//
// This is SLDS's `slds-listbox__option_entity` media object — figure, primary
// text, meta text — with the term highlight computed rather than authored.
// EntityDisplay (reading-extras) is the natural composition and was the first
// choice, but its `@title` is a string with no title block, so the matched
// term could not carry a <mark>. Gap noted for that component's owner.
export interface RecordFaceSignature {
  Args: {
    /** The record to render. */
    record: PickerRecord;
    /** Search term to highlight inside `label` (case-insensitive, first hit). */
    term?: string;
    /** 'sm' shrinks the visual and drops the meta line (pill dress). */
    size?: 'sm' | 'md';
    /** Force the meta line off even at 'md'. */
    hideMeta?: boolean;
  };
  Element: HTMLSpanElement;
}

export class RecordFace extends Component<RecordFaceSignature> {
  get size() {
    return this.args.size ?? 'md';
  }
  get icon() {
    return iconFor(this.args.record?.icon);
  }
  get avatarSize() {
    return this.size === 'sm' ? 15 : 21;
  }
  get showMeta() {
    return (
      this.size === 'md' && !this.args.hideMeta && Boolean(this.args.record?.meta)
    );
  }
  get parts() {
    let label = this.args.record?.label ?? '';
    let term = (this.args.term ?? '').trim();
    if (!term) {
      return { before: label, match: '', after: '' };
    }
    let at = label.toLowerCase().indexOf(term.toLowerCase());
    if (at < 0) {
      return { before: label, match: '', after: '' };
    }
    return {
      before: label.slice(0, at),
      match: label.slice(at, at + term.length),
      after: label.slice(at + term.length),
    };
  }
  <template>
    <span
      class='pretui-rface'
      data-size={{this.size}}
      data-test-pretui-record-face
      ...attributes
    >
      <span class='pretui-rface-visual' aria-hidden='true'>
        {{#if this.icon}}
          {{#let this.icon as |RecordIcon|}}<RecordIcon />{{/let}}
        {{else}}
          <Avatar @name={{@record.label}} @size={{this.avatarSize}} />
        {{/if}}
      </span>
      <span class='pretui-rface-text'>
        <span class='pretui-rface-label'>{{#if this.parts.match}}{{this.parts.before}}<mark
              class='pretui-rface-mark'
            >{{this.parts.match}}</mark>{{this.parts.after}}{{else}}{{@record.label}}{{/if}}</span>
        {{#if this.showMeta}}
          <span class='pretui-rface-meta'>{{@record.meta}}</span>
        {{/if}}
      </span>
    </span>
    <style scoped>
      @layer PretComponent {
        .pretui-rface {
          display: flex;
          align-items: center;
          gap: var(--space-3, 8px);
          min-width: 0;
          text-align: left;
        }
        .pretui-rface[data-size='sm'] {
          gap: 5px;
        }
        .pretui-rface-visual {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex: none;
          width: var(--pretui-rface-visual-size, 21px);
          height: var(--pretui-rface-visual-size, 21px);
          color: var(--muted-foreground);
        }
        .pretui-rface[data-size='sm'] .pretui-rface-visual {
          width: var(--pretui-rface-visual-size, 15px);
          height: var(--pretui-rface-visual-size, 15px);
        }
        .pretui-rface-visual svg {
          width: 100%;
          height: 100%;
        }
        .pretui-rface-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
          line-height: 1.25;
        }
        .pretui-rface-label {
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pretui-rface[data-size='sm'] .pretui-rface-label {
          font-size: var(--text-ui-sm, 11.5px);
          font-weight: 500;
        }
        /* the matched run — a tint of the accent, never a contrast flip */
        .pretui-rface-mark {
          background: color-mix(
            in oklch,
            var(--primary) 22%,
            transparent
          );
          color: inherit;
          border-radius: 3px;
          padding: 0 1px;
        }
        .pretui-rface-meta {
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      }
    </style>
  </template>
}
