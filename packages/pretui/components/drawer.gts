// Pretui — Drawer: a slide-over panel on the native <dialog> top layer.
import Component from '@glimmer/component';
import { emit } from '../pretui-primitives';
import { resolveDrawerPlacement, resolveOpen, modalBehavior } from '../internal/overlay';
import type { PlacementArgs, DrawerPlacement, OpenArgs } from '../internal/overlay';

// An agent asking for a "Sheet" means THIS component (shadcn's Sheet is a
// slide-over; Pretui's Sheet is a spreadsheet grid). Vaul and shadcn spell
// the edge `direction='right'`, Mantine `position='right'`, Radix `side`;
// all three land on the logical `@placement` here — `right` → `end`.
export interface DrawerSignature {
  Args: OpenArgs &
    PlacementArgs & {
      /** Canonical close notify — optional, see Dialog. */
      onClose?: () => void;
      /** alias — the Radix/shadcn layer notify, called with `false` */
      onOpenChange?: (open: boolean) => void;
      label?: string;
      placement?: DrawerPlacement | string;
      dismissible?: boolean;
    };
  Blocks: { title: []; default: []; footer: [] };
  Element: HTMLDialogElement;
}

export class Drawer extends Component<DrawerSignature> {
  get dismissible() {
    return this.args.dismissible ?? true;
  }
  get open() {
    return resolveOpen(this.args);
  }
  get placement(): DrawerPlacement {
    return resolveDrawerPlacement(this.args);
  }
  private requestClose() {
    emit([this.args.onClose]);
    emit([this.args.onOpenChange], false);
  }
  onCancel = (e: Event) => {
    e.preventDefault();
    if (this.dismissible) {
      this.requestClose();
    }
  };
  onClick = (e: Event) => {
    if (this.dismissible && e.target === e.currentTarget) {
      this.requestClose();
    }
  };
  <template>
    <dialog
      class='pretui-drawer'
      data-placement={{this.placement}}
      aria-label={{@label}}
      data-test-pretui-drawer
      {{modalBehavior this.open this.onCancel this.onClick}}
      ...attributes
    >
      <div class='pretui-drawer-inner'>
        {{#if (has-block 'title')}}
          <header class='pretui-drawer-title'>{{yield to='title'}}</header>
        {{/if}}
        <div class='pretui-drawer-body'>{{yield}}</div>
        {{#if (has-block 'footer')}}
          <footer class='pretui-drawer-footer'>{{yield to='footer'}}</footer>
        {{/if}}
      </div>
    </dialog>
    <style scoped>
      .pretui-drawer {
        border: 0;
        padding: 0;
        background: var(--card);
        color: var(--foreground);
        box-shadow: var(--pretui-shadow-overlay, 0 0 0 1px var(--border), 0 12px 40px rgb(16 24 40 / 0.18));
        font-family: var(--font-sans);
        font-size: var(--text-body, 15px);
        max-width: none;
        max-height: none;
      }
      .pretui-drawer[data-placement='end'],
      .pretui-drawer[data-placement='start'] {
        width: min(var(--pretui-drawer-size, 360px), calc(100vw - 48px));
        height: 100dvh;
        margin-block: 0;
      }
      .pretui-drawer[data-placement='end'] {
        margin-inline: auto 0;
        border-radius: var(--radius-surface, 10px) 0 0 var(--radius-surface, 10px);
      }
      .pretui-drawer[data-placement='start'] {
        margin-inline: 0 auto;
        border-radius: 0 var(--radius-surface, 10px) var(--radius-surface, 10px) 0;
      }
      .pretui-drawer[data-placement='bottom'] {
        width: 100vw;
        margin: auto 0 0;
        max-height: min(var(--pretui-drawer-size, 420px), 80dvh);
        border-radius: var(--radius-surface, 10px) var(--radius-surface, 10px) 0 0;
      }
      .pretui-drawer::backdrop {
        background: var(--pretui-overlay-scrim, rgb(16 24 40 / 0.4));
      }
      .pretui-drawer[open] {
        opacity: 1;
        transform: none;
        transition: opacity 220ms cubic-bezier(0.23, 1, 0.32, 1),
          transform 220ms cubic-bezier(0.23, 1, 0.32, 1);
      }
      @starting-style {
        .pretui-drawer[open][data-placement='end'] {
          opacity: 0;
          transform: translateX(24px);
        }
        .pretui-drawer[open][data-placement='start'] {
          opacity: 0;
          transform: translateX(-24px);
        }
        .pretui-drawer[open][data-placement='bottom'] {
          opacity: 0;
          transform: translateY(24px);
        }
      }
      .pretui-drawer-inner {
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: var(--space-4, 11px);
        padding: var(--space-6, 19px);
        height: 100%;
        box-sizing: border-box;
        align-content: start;
      }
      .pretui-drawer-title {
        font-size: var(--text-heading, 19px);
        font-weight: var(--weight-heading, 700);
        letter-spacing: var(--track-heading, -0.02em);
      }
      .pretui-drawer-body {
        overflow-y: auto;
        color: var(--muted-foreground);
        line-height: calc(var(--leading-body, 24px) / var(--text-body, 15px));
      }
      .pretui-drawer-footer {
        display: flex;
        justify-content: flex-end;
        gap: var(--space-3, 8px);
        border-top: 1px solid var(--border);
        padding-top: var(--space-4, 11px);
      }
      @media (prefers-reduced-motion: reduce) {
        .pretui-drawer[open] {
          transition: none;
        }
      }
    </style>
  </template>
}

