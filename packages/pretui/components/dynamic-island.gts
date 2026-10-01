// Pretui — DynamicIsland: a pill that morphs between idle, compact and expanded views.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';

// ── DynamicIsland ────────────────────────────────────────────────────────

export type IslandView = 'idle' | 'compact' | 'expanded';

export interface DynamicIslandSignature {
  Args: {
    /** Controlled view. Omit for uncontrolled. */
    view?: IslandView;
    /** Initial view for the uncontrolled case. Default `compact`. */
    defaultView?: IslandView;
    /** Fires with the next view on every change. */
    onViewChange?: (view: IslandView) => void;
    /** Accessible name for the capsule. */
    label?: string;
    /** Let the reader toggle compact ⇄ expanded. Default true. Turn it off
     * for a purely host-driven status capsule. */
    expandable?: boolean;
  };
  Blocks: {
    /** The resting sliver — a dot, a bar, a single glyph. */
    idle: [];
    /** The one-line state: what is happening, right now. */
    compact: [];
    /** The detail: controls, progress, a description. */
    expanded: [];
  };
  Element: HTMLDivElement;
}

/**
 * A status capsule that morphs between three views.
 *
 * ```hbs
 * <DynamicIsland @label='Indexing status' @view={{this.view}}>
 *   <:idle><span class='dot'></span></:idle>
 *   <:compact>Indexing 42 cards…</:compact>
 *   <:expanded><Progress @value={{this.done}} /></:expanded>
 * </DynamicIsland>
 * ```
 *
 * The motion is the point and it is legitimate under Law 5: the capsule
 * growing is what tells the reader that the SAME object gained detail,
 * rather than a second, unrelated surface appearing. Nothing animates while
 * the view is unchanged.
 *
 * Better than the inspiration (cult-ui's dynamic-island): upstream drives
 * the whole thing with a spring engine and a `setTimeout` state machine that
 * advances itself — which is decoration, not state, and is forbidden in this
 * realm besides. Here the view is DATA: controlled by the host or toggled by
 * the reader, never by a clock. The geometry is a set of `--pretui-island-*`
 * tokens rather than hard-coded pixels, the capsule carries `role='status'`
 * so a state change is announced without stealing focus, and the toggle is a
 * real named button rather than a click handler on a div.
 */
export class DynamicIsland extends Component<DynamicIslandSignature> {
  @tracked private internalView: IslandView | undefined = undefined;

  private bodyId = guidFor(this) + '-island-body';

  get view(): IslandView {
    return (
      this.args.view ?? this.internalView ?? this.args.defaultView ?? 'compact'
    );
  }

  get expandable(): boolean {
    return this.args.expandable ?? true;
  }

  get isExpanded(): boolean {
    return this.view === 'expanded';
  }

  get isIdle(): boolean {
    return this.view === 'idle';
  }

  get toggleLabel(): string {
    return this.isExpanded ? 'Collapse details' : 'Expand details';
  }

  toggle = () => {
    let next: IslandView = this.isExpanded ? 'compact' : 'expanded';
    if (this.args.view === undefined) {
      this.internalView = next;
    }
    this.args.onViewChange?.(next);
  };

  <template>
    <div class='pretui-island' data-test-pretui-dynamic-island ...attributes>
      <div
        class='pretui-island-capsule'
        data-view={{this.view}}
        role='status'
        aria-label={{@label}}
        id={{this.bodyId}}
        data-test-pretui-island-capsule
      >
        {{! Exactly one view is rendered at a time — which is what makes
            @starting-style fire on the incoming one, and what stops the
            capsule from being sized by the largest block it was given. }}
        <div class='pretui-island-body'>
          {{#if this.isExpanded}}
            <div class='pretui-island-view' data-view='expanded'>
              {{yield to='expanded'}}
            </div>
          {{else if this.isIdle}}
            <div class='pretui-island-view' data-view='idle'>
              {{yield to='idle'}}
            </div>
          {{else}}
            <div class='pretui-island-view' data-view='compact'>
              {{yield to='compact'}}
            </div>
          {{/if}}
        </div>

        {{#if this.expandable}}
          {{! A named button rather than a click handler on the capsule: the
              capsule's own content is live status text, and folding that
              into a button's accessible name would make the name change
              every time the status did. Collapsed, the button covers the
              capsule (the island idiom — tap anywhere); expanded, it
              shrinks to a corner so the detail view keeps its own pointer
              events. }}
          <button
            type='button'
            class='pretui-island-toggle'
            aria-expanded={{if this.isExpanded 'true' 'false'}}
            aria-controls={{this.bodyId}}
            aria-label={{this.toggleLabel}}
            data-test-pretui-island-toggle
            {{on 'click' this.toggle}}
          ><span class='pretui-island-caret' aria-hidden='true'></span></button>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .pretui-island {
        display: flex;
        justify-content: center;
        font-family: var(--font-sans);
      }
      .pretui-island-capsule {
        position: relative;
        display: grid;
        overflow: hidden;
        color: var(--pretui-island-ink, var(--card));
        background: var(--pretui-island-ground, var(--foreground));
        box-shadow: var(--pretui-shadow-raised, 0 2px 10px rgb(0 0 0 / 0.22));
        inline-size: var(--pretui-island-width, 260px);
        block-size: var(--pretui-island-height, 44px);
        border-radius: var(--pretui-island-radius, 22px);
        /* THE morph. Three properties, one transition, and the reader reads
           it as one object changing rather than three surfaces swapping. */
        transition: inline-size 340ms cubic-bezier(0.23, 1, 0.32, 1),
          block-size 340ms cubic-bezier(0.23, 1, 0.32, 1),
          border-radius 340ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-island-capsule[data-view='idle'] {
        inline-size: var(--pretui-island-idle-width, 96px);
        block-size: var(--pretui-island-idle-height, 26px);
        border-radius: var(--pretui-island-idle-radius, 13px);
      }
      .pretui-island-capsule[data-view='expanded'] {
        inline-size: var(--pretui-island-expanded-width, 340px);
        block-size: var(--pretui-island-expanded-height, 156px);
        border-radius: var(--pretui-island-expanded-radius, 26px);
      }
      .pretui-island-body {
        display: grid;
        align-items: center;
        min-inline-size: 0;
        block-size: 100%;
        padding-inline: var(--space-5, 14px);
        padding-block: var(--space-3, 8px);
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-island-capsule[data-view='idle'] .pretui-island-body {
        padding-inline: var(--space-3, 8px);
        padding-block: 0;
        justify-items: center;
      }
      .pretui-island-view {
        min-inline-size: 0;
        opacity: 1;
        /* The incoming view fades up as the box grows. @starting-style is
           what gives an ENTERING element something to animate from without
           a JS frame — verified to survive the scoped-CSS transpile. */
        transition: opacity 220ms ease-out;
      }
      @starting-style {
        .pretui-island-view {
          opacity: 0;
        }
      }
      .pretui-island-view[data-view='expanded'] {
        align-self: start;
        inline-size: 100%;
      }
      .pretui-island-toggle {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        display: grid;
        place-items: end center;
        padding-block-end: 6px;
      }
      .pretui-island-capsule[data-view='expanded'] .pretui-island-toggle {
        inset: auto 6px 6px auto;
        inline-size: 30px;
        block-size: 30px;
        border-radius: 999px;
        place-items: center;
        padding: 0;
        background: color-mix(in oklch, var(--card) 16%, transparent);
      }
      @media (any-pointer: coarse) {
        .pretui-island-capsule[data-view='expanded'] .pretui-island-toggle {
          inline-size: 44px;
          block-size: 44px;
        }
      }
      .pretui-island-toggle:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: -3px;
        border-radius: inherit;
      }
      .pretui-island-caret {
        inline-size: 7px;
        block-size: 7px;
        border-inline-end: 1.5px solid currentColor;
        border-block-end: 1.5px solid currentColor;
        transform: rotate(45deg);
        opacity: 0.7;
        transition: transform 340ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      .pretui-island-capsule[data-view='expanded'] .pretui-island-caret {
        transform: rotate(-135deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-island-capsule,
        .pretui-island-view,
        .pretui-island-caret {
          transition: none;
        }
      }
    </style>
  </template>
}
