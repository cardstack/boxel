// Pretui — QuickLook: a sheet that shows a card or file over the transcript, with a way to open it properly.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { guidFor } from '@ember/object/internals';
import { modifier } from 'ember-modifier';
import { motion } from 'glimmer-motion';
import XIcon from '@cardstack/boxel-icons/x';
import { IconButton } from './icon-button';
import { listenDocumentCapture } from '../focus';

// ── QuickLook ────────────────────────────────────────────────────────────
// A look before a commitment: the reader clicks a card or a file in the
// transcript and sees it here, over the transcript, without leaving the
// conversation. The bar says what it is (its kind, quietly, and its title)
// and offers the way to open it properly; Escape, Space, the close button
// and a click on the backdrop all put it away.
//
// Presentational only. Whether it is open is the caller's state: render it
// to open it, stop rendering it to close it. It never waits on an animation
// and never keeps a "closing" state of its own (ADR 007 §1.1).
//
// Motion is declared, not performed: the sheet and the backdrop carry
// `{{motion id= role=}}` so a Choreo region around them can fly the sheet
// out of whatever opened it and fade the backdrop. Outside a region the
// declaration does nothing and the sheet simply appears.

export interface QuickLookSignature {
  Args: {
    /** the card's or the file's title: the sheet's accessible name */
    title: string;
    /** what it is, said quietly before the title: 'Tea lot', 'PNG image' */
    kind?: string;
    /** put it away: Escape, Space, the close button, the backdrop */
    onClose: () => void;
    /** the close button's name (default 'Close') */
    closeLabel?: string;
    /** where focus goes when it closes. Default: whatever had focus when
     * it opened, the pill or embed that opened it */
    returnFocusTo?: HTMLElement | null;
  };
  Blocks: {
    /** the bar's actions: Open (the one primary action), Open in code */
    actions: [];
    /** the card or the file; it scrolls in its own box */
    default: [];
  };
  Element: HTMLDivElement;
}

// Space closes only when it would not do something else: typing a space,
// pressing a focused button or link, or toggling a control inside the card.
const SPACE_KEEPERS =
  'input, textarea, select, button, a[href], [contenteditable=""], [contenteditable="true"], [role="button"], [role="checkbox"], [role="switch"], [role="textbox"], [role="menuitem"], [role="option"], [role="tab"]';

export class QuickLook extends Component<QuickLookSignature> {
  private guid = guidFor(this);

  get titleId(): string {
    return this.guid + '-title';
  }
  get closeLabel(): string {
    return this.args.closeLabel ?? 'Close';
  }

  close = () => {
    this.args.onClose();
  };

  /** Escape always; Space when focus is not somewhere a space means
   * something else. A key another handler already claimed is left alone,
   * so the keypress that opened the sheet cannot also close it. */
  onKey = (event: Event) => {
    let ev = event as KeyboardEvent;
    if (ev.defaultPrevented || ev.isComposing) {
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
      return;
    }
    if (ev.key === ' ' || ev.key === 'Spacebar') {
      let target = ev.target as Element | null;
      if (target instanceof Element && target.closest(SPACE_KEEPERS)) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      this.close();
    }
  };

  /** Focus moves into the sheet when it is rendered, and back to what
   * opened it when it is torn down: on the state change, never at the end
   * of an animation (ADR 007 §1.5). */
  private focusIn = modifier(
    (sheet: HTMLElement, [returnTo]: [HTMLElement | null | undefined]) => {
      let previous =
        returnTo ??
        (document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null);
      sheet.focus({ preventScroll: true });
      return () => {
        let active = document.activeElement;
        let focusWasHere =
          !active || active === document.body || sheet.contains(active);
        if (focusWasHere && previous?.isConnected) {
          previous.focus({ preventScroll: true });
        }
      };
    },
  );

  <template>
    <div
      class='pretui-quick-look'
      data-test-pretui-quick-look
      {{listenDocumentCapture 'keydown' this.onKey}}
    >
      {{! the backdrop is a pointer target only: the close button is the
          keyboard's way out, so it stays out of the tab order and the tree }}
      {{! template-lint-disable no-invalid-interactive }}
      <div
        class='pretui-quick-look-backdrop'
        aria-hidden='true'
        data-test-pretui-quick-look-backdrop
        {{motion id='quick-look-backdrop' role='quick-look-backdrop'}}
        {{on 'click' this.close}}
      ></div>
      <div
        class='pretui-quick-look-sheet'
        role='dialog'
        aria-modal='true'
        aria-labelledby={{this.titleId}}
        tabindex='-1'
        data-test-pretui-quick-look-sheet
        {{motion id='quick-look' role='quick-look'}}
        {{this.focusIn @returnFocusTo}}
        ...attributes
      >
        <div class='pretui-quick-look-bar'>
          <div class='pretui-quick-look-heading'>
            {{#if @kind}}
              <span
                class='pretui-quick-look-kind'
                data-test-pretui-quick-look-kind
              >{{@kind}}</span>
            {{/if}}
            <h2
              id={{this.titleId}}
              class='pretui-quick-look-title'
              title={{@title}}
              data-test-pretui-quick-look-title
            >{{@title}}</h2>
          </div>
          <div
            class='pretui-quick-look-actions'
            data-test-pretui-quick-look-actions
          >
            {{yield to='actions'}}
          </div>
          <IconButton
            class='pretui-quick-look-close'
            @label={{this.closeLabel}}
            @icon={{XIcon}}
            @tone='neutral'
            @appearance='plain'
            @size='s'
            data-test-pretui-quick-look-close
            {{on 'click' this.close}}
          />
        </div>
        <div class='pretui-quick-look-body' data-test-pretui-quick-look-body>
          {{yield}}
        </div>
      </div>
    </div>
    <style scoped>
      @layer PretComponent {
        .pretui-quick-look {
          position: absolute;
          inset: 0;
          z-index: var(--pretui-quick-look-z, 20);
        }
        .pretui-quick-look-backdrop {
          position: absolute;
          inset: 0;
          background: var(
            --pretui-scrim,
            color-mix(in oklch, var(--background, black) 55%, transparent)
          );
        }
        .pretui-quick-look-sheet {
          position: absolute;
          inset: var(
            --pretui-quick-look-inset,
            var(--boxel-sp-3xl) var(--boxel-sp-sm) var(--boxel-sp-sm)
          );
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: hidden;
          border-radius: var(--boxel-border-radius-lg);
          background: var(--card, var(--background));
          color: var(--card-foreground, var(--foreground));
          box-shadow:
            var(--pretui-shadow-hairline, 0 0 0 1px var(--border)),
            var(--pretui-shadow-overlay, 0 12px 32px rgb(0 0 0 / 0.32));
        }
        .pretui-quick-look-sheet:focus {
          outline: none;
        }
        .pretui-quick-look-sheet:focus-visible {
          box-shadow:
            0 0 0 2px var(--ring),
            var(--pretui-shadow-overlay, 0 12px 32px rgb(0 0 0 / 0.32));
        }
        .pretui-quick-look-bar {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          min-height: var(--boxel-sp-3xl);
          padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-xs)
            var(--boxel-sp);
          border-bottom: 1px solid var(--border);
        }
        .pretui-quick-look-heading {
          display: flex;
          flex-direction: column;
          flex: 1;
          min-width: 0;
        }
        .pretui-quick-look-kind {
          font-size: var(--boxel-caption-font-size);
          line-height: var(--boxel-caption-line-height);
          color: var(--subtle-foreground);
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .pretui-quick-look-title {
          margin: 0;
          font-size: var(--boxel-ui-label-font-size);
          line-height: var(--boxel-ui-label-line-height);
          font-weight: 600;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
        .pretui-quick-look-actions {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-xs);
          flex-shrink: 0;
        }
        .pretui-quick-look-actions:empty {
          display: none;
        }
        .pretui-quick-look-close {
          flex-shrink: 0;
          color: var(--muted-foreground);
        }
        .pretui-quick-look-body {
          flex: 1;
          min-height: 0;
          overflow: auto;
          overscroll-behavior: contain;
        }
      }
    </style>
  </template>
}
