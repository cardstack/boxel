// Pretui — GraphOutline: the accessible list form of a node-and-edge graph.
// Pretui — surfaces territory: GraphOutline, the node graph as text.
//
// This module deliberately imports NOTHING from `./surfaces/` — no engine,
// no canvas, no DOM measurement. Two reasons, both load-bearing:
//
//   1. Local `boxel test` cannot load the surfaces bundle at all (the
//      in-process test server's shim set has no
//      `@ember/template-compilation`). Keeping the accessible surface out
//      of the engine's module graph is the only way it gets RENDER proof
//      rather than "indexed clean", and the accessible surface is exactly
//      the part that must not ship on a promise.
//   2. An outline that needs no canvas can be placed ANYWHERE — beside the
//      graph, in a drawer, on its own page, or as the entire mobile
//      rendering of a graph too big to pan. NodeCanvas uses it for
//      `@summary`; it is not owned by NodeCanvas.
//
// ── Why a canvas needs this at all ───────────────────────────────────────
// An infinite pan/zoom plane is the worst surface in UI for a screen
// reader, and xyflow's answer is a `role="application"` with per-node
// `aria-roledescription="node"` — which reads a node out when you land on
// it and tells you nothing about the SHAPE of the graph. Worse, by
// upstream's own reckoning there is NO keyboard path to create or
// reconnect an edge: connections are pointer-only in React Flow and in the
// Ember port. A graph editor that cannot be operated without a mouse is
// not an accessible graph editor, however good its node roles are.
//
// GraphOutline is the answer to both:
//   • It states the graph's shape as a sentence and its edges as text —
//     "Wuyi Origins connects to Spring Lot 14" — including edge LABELS,
//     which the picture draws as 9px type over a line and the mirror can
//     read out in full.
//   • Every node is a real <button>: activating it selects and focuses
//     that node in the picture. That is a keyboard route to any node in a
//     graph of any size, in one Tab sequence, with no panning.
//   • CONNECT MODE gives keyboard users the edge-drawing gesture upstream
//     never had. Arm a source, activate a target, done — with a live
//     region announcing each step and Escape to cancel at any point.
//
// ── The sr-only trap, and how this handles it ────────────────────────────
// The default mode is `sr-only`, because the picture is the point and the
// mirror is a description. But a visually-hidden region containing real
// focusable controls strands a sighted keyboard user: focus vanishes into
// nothing. So `sr-only` here means "hidden until focus arrives" — the
// region unclips on `:focus-within` and becomes the visible caption strip.
// It is never a focus trap and never invisible while focused.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

/** The little a node must supply to be described. Everything else is ignored. */
export interface OutlineNode {
  id: string;
  /** wins over everything; NodeCanvas fills it from the node's data */
  ariaLabel?: string;
  data?: {
    title?: string;
    label?: unknown;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** The little an edge must supply. `label` is read out; the picture draws it small. */
export interface OutlineEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
  [key: string]: unknown;
}

/** Node name, in the order a reader would want it. */
export function outlineNameOf(node: OutlineNode): string {
  let data = node.data ?? {};
  let label = data['label'];
  return (
    node.ariaLabel ??
    data.title ??
    (typeof label === 'string' ? label : undefined) ??
    node.id
  );
}

interface OutlineLink {
  key: string;
  name: string;
  label?: string;
  hasLabel: boolean;
}

interface OutlineRow {
  id: string;
  name: string;
  status?: string;
  hasStatus: boolean;
  outgoing: OutlineLink[];
  incoming: OutlineLink[];
  hasOutgoing: boolean;
  hasIncoming: boolean;
  outText: string;
  inText: string;
  isActive: boolean;
  isSource: boolean;
  /** the accessible name of this row's button, which CHANGES in connect mode */
  buttonLabel: string;
  connectLabel: string;
  connectPressed: string;
}

let outlineSeq = 0;

export interface GraphOutlineSignature {
  Args: {
    /** the same nodes the picture draws */
    nodes?: OutlineNode[];
    /** the same edges the picture draws */
    edges?: OutlineEdge[];
    /** name of the graph this describes; used to name the region */
    label?: string;
    /** `sr-only` (default) hides until focused; `visible` is always a caption strip */
    mode?: 'sr-only' | 'visible';
    /** the node currently selected in the picture, so the outline can mark it */
    activeId?: string;
    /** activating a node row calls this — select and focus it in the picture */
    onSelect?: (id: string) => void;
    /**
     * called when the reader completes a connection in connect mode. Its
     * presence is what turns connect mode on; without it the outline is
     * read-only and no arming control is drawn.
     */
    onConnect?: (source: string, target: string) => void;
    /** re-run the auto-layout; drawn only when supplied */
    onRelayout?: () => void;
    /** id for the region, so a canvas can point `aria-describedby` at it */
    outlineId?: string;
  };
  Element: HTMLDivElement;
}

const NO_NODES: OutlineNode[] = [];
const NO_EDGES: OutlineEdge[] = [];

export class GraphOutline extends Component<GraphOutlineSignature> {
  private fallbackId = `pretui-graph-outline-${(outlineSeq += 1)}`;

  /** id of the node a connection is being drawn FROM, or undefined. */
  @tracked private armed: string | undefined = undefined;

  get outlineId() {
    return this.args.outlineId ?? this.fallbackId;
  }

  get mode() {
    return this.args.mode ?? 'sr-only';
  }

  get nodes() {
    return this.args.nodes ?? NO_NODES;
  }

  get edges() {
    return this.args.edges ?? NO_EDGES;
  }

  get regionLabel() {
    return this.args.label ? `${this.args.label}, as a list` : 'Graph, as a list';
  }

  get canConnect() {
    return typeof this.args.onConnect === 'function';
  }

  get canRelayout() {
    return typeof this.args.onRelayout === 'function';
  }

  get names(): Map<string, string> {
    let names = new Map<string, string>();
    for (let node of this.nodes) {
      names.set(node.id, outlineNameOf(node));
    }
    return names;
  }

  get armedName() {
    return this.armed ? (this.names.get(this.armed) ?? this.armed) : '';
  }

  /**
   * One row per node, with both directions spelled out. Upstream's own
   * summary listed OUTGOING links only, which reads the graph as a set of
   * one-way announcements and leaves a sink node saying nothing at all —
   * "no outgoing connections" is not the same information as "fed by
   * Spring Lot 14".
   */
  get rows(): OutlineRow[] {
    let names = this.names;
    let armed = this.armed;
    return this.nodes.map((node) => {
      let outgoing: OutlineLink[] = [];
      let incoming: OutlineLink[] = [];
      let seq = 0;
      for (let edge of this.edges) {
        seq += 1;
        let label = typeof edge.label === 'string' ? edge.label : undefined;
        if (edge.source === node.id) {
          outgoing.push({
            key: edge.id ?? `o-${node.id}-${edge.target}-${seq}`,
            name: names.get(edge.target) ?? edge.target,
            label,
            hasLabel: Boolean(label),
          });
        }
        if (edge.target === node.id) {
          incoming.push({
            key: edge.id ?? `i-${node.id}-${edge.source}-${seq}`,
            name: names.get(edge.source) ?? edge.source,
            label,
            hasLabel: Boolean(label),
          });
        }
      }
      let name = names.get(node.id) ?? node.id;
      let status =
        typeof node.data?.status === 'string' ? node.data.status : undefined;
      let isSource = armed === node.id;
      let phrase = (links: OutlineLink[]) =>
        links
          .map((link) => (link.label ? `${link.name} (${link.label})` : link.name))
          .join(', ');
      let outText = outgoing.length
        ? `connects to ${phrase(outgoing)}`
        : 'no outgoing connections';
      let inText = incoming.length ? `fed by ${phrase(incoming)}` : '';
      let buttonLabel = armed
        ? isSource
          ? `${name}, connection source`
          : `Connect ${this.armedName} to ${name}`
        : `${name}. ${outText}${inText ? `. ${inText}` : ''}`;
      return {
        id: node.id,
        name,
        status,
        hasStatus: Boolean(status),
        outgoing,
        incoming,
        hasOutgoing: outgoing.length > 0,
        hasIncoming: incoming.length > 0,
        outText,
        inText,
        isActive: this.args.activeId === node.id,
        isSource,
        buttonLabel,
        connectLabel: isSource
          ? `Cancel connection from ${name}`
          : `Start a connection from ${name}`,
        connectPressed: isSource ? 'true' : 'false',
      };
    });
  }

  get headline() {
    let n = this.nodes.length;
    let e = this.edges.length;
    return `${n} ${n === 1 ? 'node' : 'nodes'}, ${e} ${
      e === 1 ? 'connection' : 'connections'
    }.`;
  }

  /** The live-region line. Empty string when nothing is in flight. */
  get status() {
    if (!this.armed) {
      return '';
    }
    return `Connecting from ${this.armedName}. Choose a target, or press Escape to cancel.`;
  }

  private pick = (id: string) => {
    if (this.armed && this.armed !== id) {
      let source = this.armed;
      this.armed = undefined;
      this.args.onConnect?.(source, id);
      return;
    }
    if (this.armed === id) {
      this.armed = undefined;
      return;
    }
    this.args.onSelect?.(id);
  };

  private toggleArm = (id: string) => {
    this.armed = this.armed === id ? undefined : id;
  };

  private relayout = () => {
    this.args.onRelayout?.();
  };

  /**
   * Escape cancels an in-flight connection. It lives on the buttons rather
   * than the list because realm lint's `no-invalid-interactive` refuses
   * `{{on}}` on a container that carries no widget role — and because a
   * button is where the focus actually is when a reader wants to back out.
   */
  private onKey = (event: Event) => {
    let key = (event as KeyboardEvent).key;
    if (key === 'Escape' && this.armed) {
      event.preventDefault();
      // The engine binds its own keydown on the WINDOW in the capture
      // phase; stopping propagation here keeps an Escape meant for the
      // connection out of the canvas's "cancel drag, then edit, then
      // selection" chain.
      event.stopPropagation();
      this.armed = undefined;
    }
  };

  <template>
    <div
      class='pretui-graph-outline'
      id={{this.outlineId}}
      data-mode={{this.mode}}
      data-armed={{if this.armed 'true' 'false'}}
      data-test-pretui-graph-outline
      ...attributes
    >
      <div class='pgo-head'>
        <p class='pgo-headline' data-test-pretui-graph-outline-headline>
          {{this.headline}}
        </p>
        {{#if this.canRelayout}}
          <button
            type='button'
            class='pgo-act'
            data-test-pretui-graph-outline-relayout
            {{on 'click' this.relayout}}
            {{on 'keydown' this.onKey}}
          >Tidy layout</button>
        {{/if}}
      </div>

      {{! The live region is ALWAYS in the DOM — a status element inserted
          at the moment it has something to say is frequently not announced,
          because assistive tech has to have been watching it beforehand. }}
      <p
        class='pgo-status'
        role='status'
        aria-live='polite'
        data-test-pretui-graph-outline-status
      >{{this.status}}</p>

      <ul class='pgo-list'>
        {{#each this.rows key='id' as |row|}}
          <li
            class='pgo-row'
            data-active={{if row.isActive 'true' 'false'}}
            data-source={{if row.isSource 'true' 'false'}}
            data-test-pretui-graph-outline-row={{row.id}}
          >
            <button
              type='button'
              class='pgo-name'
              aria-label={{row.buttonLabel}}
              aria-current={{if row.isActive 'true' 'false'}}
              data-test-pretui-graph-outline-pick={{row.id}}
              {{on 'click' (fn this.pick row.id)}}
              {{on 'keydown' this.onKey}}
            >{{row.name}}</button>

            {{#if row.hasStatus}}
              <span class='pgo-status-word'>{{row.status}}</span>
            {{/if}}

            <span class='pgo-links' aria-hidden='true'>{{row.outText}}</span>
            {{#if row.hasIncoming}}
              <span class='pgo-links' aria-hidden='true'>{{row.inText}}</span>
            {{/if}}

            {{#if this.canConnect}}
              <button
                type='button'
                class='pgo-act pgo-connect'
                aria-label={{row.connectLabel}}
                aria-pressed={{row.connectPressed}}
                data-test-pretui-graph-outline-arm={{row.id}}
                {{on 'click' (fn this.toggleArm row.id)}}
                {{on 'keydown' this.onKey}}
              >{{if row.isSource 'Cancel' 'Connect'}}</button>
            {{/if}}
          </li>
        {{/each}}
      </ul>
    </div>

    <style scoped>
      @layer PretComponent {
        /* `sr-only` means hidden UNTIL FOCUSED, never hidden while focused —
           the region owns real buttons, and a keyboard user must be able to
           see where their focus went. :focus-within is the whole mechanism;
           there is no JS in this component's visibility at all. */
        .pretui-graph-outline[data-mode='sr-only']:not(:focus-within) {
          position: absolute;
          width: 1px;
          height: 1px;
          margin: -1px;
          padding: 0;
          overflow: hidden;
          clip: rect(0 0 0 0);
          clip-path: inset(50%);
          white-space: nowrap;
          border: 0;
        }

        .pretui-graph-outline {
          position: absolute;
          inset-block-end: 0;
          inset-inline: 0;
          z-index: 6;
          max-height: var(--pretui-canvas-summary-height, 8rem);
          overflow: auto;
          box-sizing: border-box;
          padding: var(--space-3, 8px) var(--space-4, 11px);
          background: var(
            --pretui-outline-bg,
            color-mix(in oklch, var(--card) 92%, var(--foreground))
          );
          box-shadow: 0 -1px 0 0 var(--border);
          font-family: var(--font-sans);
          font-size: var(--text-ui-sm, 11.5px);
          color: var(--card-foreground);
        }

        .pgo-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: var(--space-3, 8px);
          margin-block-end: var(--space-2, 5px);
        }

        .pgo-headline {
          margin: 0;
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          letter-spacing: var(--track-eyebrow, 0.08em);
          text-transform: uppercase;
          color: var(--muted-foreground);
        }

        /* Empty until something is in flight, so it must not reserve a line. */
        .pgo-status {
          margin: 0;
        }

        .pretui-graph-outline[data-armed='true'] .pgo-status {
          margin-block-end: var(--space-2, 5px);
          color: var(--primary);
          font-weight: 600;
        }

        .pgo-list {
          margin: 0;
          padding: 0;
          list-style: none;
          display: grid;
          gap: 2px;
        }

        .pgo-row {
          display: flex;
          align-items: baseline;
          gap: var(--space-2, 5px);
          border-radius: var(--radius-chip, 6px);
          padding-inline: 2px;
        }

        .pgo-row[data-active='true'] {
          background: color-mix(
            in oklch,
            var(--primary) 12%,
            transparent
          );
        }

        .pgo-row[data-source='true'] {
          box-shadow: inset 0 0 0 1px var(--primary);
        }

        /* The node button reads as text, not as a control — the row IS the
           content. It still behaves as a button in every other respect. */
        .pgo-name {
          appearance: none;
          margin: 0;
          padding: 0;
          border: 0;
          background: none;
          font: inherit;
          font-weight: 600;
          color: inherit;
          text-align: start;
          cursor: pointer;
          border-radius: var(--radius-chip, 6px);
        }

        .pgo-name:hover {
          text-decoration: underline;
        }

        .pgo-name:focus-visible,
        .pgo-act:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        .pgo-status-word {
          font-family: var(--font-mono);
          font-size: var(--text-ui-xs, 11px);
          color: var(--muted-foreground);
        }

        .pgo-links {
          color: var(--muted-foreground);
        }

        .pgo-act {
          appearance: none;
          margin-inline-start: auto;
          padding: 1px var(--space-2, 5px);
          border: 0;
          border-radius: var(--radius-chip, 6px);
          background: var(--muted);
          color: var(--muted-foreground);
          font: inherit;
          font-size: var(--text-ui-xs, 11px);
          cursor: pointer;
        }

        .pgo-act:hover {
          color: var(--foreground);
        }

        .pgo-row[data-source='true'] .pgo-connect {
          background: var(--primary);
          color: var(--primary-foreground);
        }
      }
    </style>
  </template>
}
