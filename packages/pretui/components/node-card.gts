// Pretui — NodeCard: the default node body on a NodeCanvas.
import Component from '@glimmer/component';
import { cssStyle } from '../pretui-css';
import { Chip } from './chip';
import { Token } from './token';
import { statusHue } from '../internal/ink';
import type { CanvasNode, NodeCardData } from '../internal/surfaces-canvas';

// ── NodeCard — the default node body ─────────────────────────────────────
// React Flow's stock node is `<div style={{padding:10, border:'1px solid
// #1a192b', borderRadius:3, background:'#fff', width:150}}>{label}</div>`:
// one string, fixed pixels, hard-coded colors, no place for structure.
// NodeCard is the Pretui reply — an eyebrow Token for the machine value,
// a real title, a supporting line, and a status Chip whose hue is derived
// from the status string (Law 2), so "roasting" is the same hue on every
// node authored by every caller. Depth is hairline + shadow (Law 1); the
// hue appears as a rail on the inline-start edge, which is the part that
// survives the screenshot test (Law 8).
//
// Handles are NOT drawn here — the shell around the body owns them, so a
// caller swapping in their own body never has to think about connectors.

export interface NodeBodySignature {
  Args: {
    /** the whole node record */
    node?: CanvasNode;
    /** node id */
    id?: string;
    /** the node's `data` payload */
    data?: NodeCardData;
    /** true while this node is in the engine's selection */
    selected?: boolean;
    /** true during a pointer drag of this node */
    dragging?: boolean;
  };
  Element: HTMLDivElement;
}

/** Shape any `@nodeBody` must satisfy: a Glimmer component over NodeBodySignature. */
export type NodeBodyComponent = new (
  owner: unknown,
  args: NodeBodySignature['Args'],
) => Component<NodeBodySignature>;

export class NodeCard extends Component<NodeBodySignature> {
  get data(): NodeCardData {
    return this.args.data ?? {};
  }
  get title(): string {
    let d = this.data;
    return d.title ?? d.label ?? this.args.id ?? 'Untitled';
  }
  get hue(): string {
    let d = this.data;
    return d.hue ?? statusHue(d.status ?? d.kind ?? this.title);
  }
  get style() {
    return cssStyle('--pretui-node-hue', this.hue);
  }
  <template>
    <div
      class='pretui-node-card'
      style={{this.style}}
      data-selected={{if @selected 'true' 'false'}}
      data-dragging={{if @dragging 'true' 'false'}}
      data-test-pretui-node-card
      ...attributes
    >
      {{#if this.data.kind}}
        <div class='pnc-kind'><Token
            @value={{this.data.kind}}
            @hue={{this.hue}}
          /></div>
      {{/if}}
      <p class='pnc-title'>{{this.title}}</p>
      {{#if this.data.meta}}
        <p class='pnc-meta'>{{this.data.meta}}</p>
      {{/if}}
      {{#if this.data.status}}
        <div class='pnc-status'><Chip
            @label={{this.data.status}}
            @hue={{this.hue}}
          /></div>
      {{/if}}
    </div>

    <style scoped>
      @layer PretComponent {
        .pretui-node-card {
          --_hue: var(--pretui-node-hue, var(--primary));
          position: relative;
          display: grid;
          gap: var(--pretui-node-gap, var(--space-2, 5px));
          justify-items: start;
          box-sizing: border-box;
          width: var(--pretui-node-width, 200px);
          padding: var(--pretui-node-padding, var(--space-4, 11px))
            var(--pretui-node-padding, var(--space-4, 11px))
            var(--pretui-node-padding, var(--space-4, 11px))
            calc(var(--pretui-node-padding, var(--space-4, 11px)) + 4px);
          border-radius: var(--pretui-node-radius, var(--radius-surface, 10px));
          background: var(--pretui-node-bg, var(--card));
          color: var(--card-foreground);
          text-align: start;
          /* Law 1 — depth is ONE property: spread hairline first, soft
             layers after. Never a border for separation. */
          box-shadow: var(
            --pretui-node-shadow,
            var(
              --pretui-shadow-card,
              0 0 0 1px var(--border),
              0 1px 2px rgb(0 0 0 / 0.14),
              0 2px 6px rgb(0 0 0 / 0.1)
            )
          );
          transition:
            box-shadow var(--pretui-dur-snap, 160ms)
              var(--pretui-ease-snap, ease),
            transform var(--pretui-dur-snap, 160ms) var(--pretui-ease-snap, ease);
        }

        /* Law 2 — one hue in, a complete treatment out. The rail is the
           pure hue; nothing else in the card is hand-picked. */
        .pretui-node-card::before {
          content: '';
          position: absolute;
          inset-block: var(--pretui-node-padding, 11px);
          inset-inline-start: 0;
          width: 3px;
          border-radius: 0 3px 3px 0;
          background: var(--_hue);
        }

        .pretui-node-card[data-selected='true'] {
          box-shadow:
            0 0 0 1px var(--primary),
            0 0 0 4px color-mix(in oklch, var(--primary) 18%, transparent),
            0 4px 14px rgb(0 0 0 / 0.14);
        }

        .pretui-node-card[data-dragging='true'] {
          box-shadow: var(
            --pretui-shadow-overlay,
            0 0 0 1px var(--border),
            0 8px 28px rgb(0 0 0 / 0.22)
          );
        }

        .pnc-kind {
          line-height: 1;
        }

        .pnc-title {
          margin: 0;
          font-size: var(--text-ui-md, 12.5px);
          font-weight: 600;
          line-height: 1.35;
          letter-spacing: var(--track-heading, -0.01em);
          color: var(--card-foreground);
        }

        .pnc-meta {
          margin: 0;
          font-size: var(--text-ui-sm, 11.5px);
          line-height: 1.4;
          color: var(--muted-foreground);
        }

        .pnc-status {
          margin-block-start: 1px;
        }

        @media (prefers-reduced-motion: reduce) {
          .pretui-node-card {
            transition: none;
          }
        }
      }
    </style>
  </template>
}
