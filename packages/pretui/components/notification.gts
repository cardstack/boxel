// Pretui — Notification: a persistent notification item — title, message, tone, action, dismiss.
import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { Spinner } from './spinner';
import { toastLive, toastRole } from './toaster';
import type { ToastTone } from './toaster';
import { resolveTone } from '../pretui-primitives';
import type { PretuiToneArg } from '../pretui-primitives';

const TONES: readonly ToastTone[] = ['neutral', 'info', 'success', 'warning', 'danger'];

export interface NotificationSignature {
  Args: {
    title: string;
    /** The second line. `<:default>` takes markup instead. */
    message?: string;
    /** Alias of `@message` — the Sonner / shadcn / Mantine name. */
    description?: string;
    /** Severity: paints the stripe and, with `@live`, picks the politeness. Accepts the kit's tone spellings. */
    tone?: ToastTone | PretuiToneArg;
    /** Replace the icon with a spinner while the thing it reports is still happening. */
    busy?: boolean;
    /** Announce the notification when it appears: `alert` for warning and danger, `status` otherwise. */
    live?: boolean;
    /** A single inline action ("Undo", "View"). */
    actionLabel?: string;
    onAction?: () => void;
    /** Shows the dismiss button. Without it the notification cannot be closed from inside. */
    onDismiss?: () => void;
    /** The dismiss button's accessible name (default 'Dismiss'). */
    dismissLabel?: string;
  };
  Blocks: {
    icon: [];
    default: [];
    action: [];
  };
  Element: HTMLDivElement;
}

/**
 * The item a notification centre lists and a Toaster stacks, without the
 * clock: it stays until someone dismisses it. It wears the Toaster's face —
 * the tone stripe, the title and message, the inline action, the dismiss
 * button — so a toast that ages out and the notification it leaves behind
 * read as the same object. Toast is the slimmer transient card.
 */
export class Notification extends Component<NotificationSignature> {
  get tone(): ToastTone {
    return resolveTone(this.args.tone, TONES, 'neutral');
  }
  get message(): string | undefined {
    return this.args.message ?? this.args.description;
  }
  get role(): 'alert' | 'status' | undefined {
    return this.args.live ? toastRole(this.tone) : undefined;
  }
  get ariaLive(): 'assertive' | 'polite' | undefined {
    return this.args.live ? toastLive(this.tone) : undefined;
  }
  get dismissLabel(): string {
    return this.args.dismissLabel ?? 'Dismiss';
  }
  onAction = () => {
    this.args.onAction?.();
  };
  onDismiss = () => {
    this.args.onDismiss?.();
  };

  <template>
    <div
      class='pretui-notification'
      role={{this.role}}
      aria-live={{this.ariaLive}}
      aria-atomic={{if @live 'true'}}
      aria-busy={{if @busy 'true'}}
      data-tone={{this.tone}}
      data-test-pretui-notification
      ...attributes
    >
      {{#if @busy}}
        <span class='pretui-notification-icon'><Spinner @size='s' aria-hidden='true' role='presentation' /></span>
      {{else if (has-block 'icon')}}
        <span class='pretui-notification-icon' aria-hidden='true'>{{yield to='icon'}}</span>
      {{/if}}
      <div class='pretui-notification-text'>
        <span class='pretui-notification-title' data-test-pretui-notification-title>{{@title}}</span>
        {{#if (has-block)}}
          <div class='pretui-notification-msg'>{{yield}}</div>
        {{else if this.message}}
          <span class='pretui-notification-msg' data-test-pretui-notification-message>{{this.message}}</span>
        {{/if}}
      </div>
      {{#if (has-block 'action')}}
        <div class='pretui-notification-action'>{{yield to='action'}}</div>
      {{else if @actionLabel}}
        <button
          type='button'
          class='pretui-notification-do'
          data-test-pretui-notification-action
          {{on 'click' this.onAction}}
        >{{@actionLabel}}</button>
      {{/if}}
      {{#if @onDismiss}}
        <button
          type='button'
          class='pretui-notification-x'
          aria-label={{this.dismissLabel}}
          data-test-pretui-notification-dismiss
          {{on 'click' this.onDismiss}}
        >
          <svg width='10' height='10' viewBox='0 0 12 12' aria-hidden='true'><path
              d='M2 2l8 8M10 2l-8 8'
              fill='none'
              stroke='currentColor'
              stroke-width='1.6'
              stroke-linecap='round'
            /></svg>
        </button>
      {{/if}}
    </div>
    <style scoped>
      .pretui-notification {
        position: relative;
        overflow: hidden;
        display: flex;
        align-items: flex-start;
        gap: var(--space-3, 0.5rem);
        padding: var(--space-4, 0.6875rem);
        padding-inline-start: calc(var(--space-4, 0.6875rem) + 3px);
        min-inline-size: 0;
        max-inline-size: var(--pretui-notification-width, 26rem);
        background: var(--popover);
        color: var(--popover-foreground);
        border-radius: var(--radius-surface, 10px);
        box-shadow: var(--pretui-shadow-raised, 0 0 0 1px var(--border), 0 6px 20px rgb(16 24 40 / 0.12));
        font-family: var(--font-sans);
        font-size: var(--text-ui-md, 0.78rem);
      }
      /* The stripe is the only place a tone paints, as in Toaster, so a
         neutral notification is genuinely neutral. */
      .pretui-notification::before {
        content: '';
        position: absolute;
        inset-block: 0;
        inset-inline-start: 0;
        inline-size: 3px;
        background: var(--pretui-notification-tone, var(--muted-foreground));
      }
      .pretui-notification[data-tone='info'] {
        --pretui-notification-tone: var(--pretui-info, var(--boxel-blue));
      }
      .pretui-notification[data-tone='success'] {
        --pretui-notification-tone: var(--success, var(--boxel-success));
      }
      .pretui-notification[data-tone='warning'] {
        --pretui-notification-tone: var(--warning, var(--boxel-warning));
      }
      .pretui-notification[data-tone='danger'] {
        --pretui-notification-tone: var(--destructive);
      }
      .pretui-notification-icon {
        flex: none;
        display: grid;
        place-items: center;
        min-block-size: 1.25rem;
        color: var(--pretui-notification-tone, var(--muted-foreground));
      }
      .pretui-notification-text {
        display: grid;
        gap: 2px;
        flex: 1;
        min-inline-size: 0;
      }
      .pretui-notification-title {
        font-weight: 600;
        overflow-wrap: anywhere;
      }
      .pretui-notification-msg {
        color: var(--muted-foreground);
        font-size: var(--text-ui-sm, 0.72rem);
        line-height: 1.5;
      }
      .pretui-notification-action {
        flex: none;
      }
      .pretui-notification-do {
        flex: none;
        border: 0;
        background: transparent;
        color: var(--pretui-notification-tone, var(--primary));
        font: inherit;
        font-weight: 600;
        padding: 2px 4px;
        border-radius: var(--radius-control, 6px);
        cursor: pointer;
      }
      .pretui-notification[data-tone='neutral'] .pretui-notification-do {
        color: var(--primary);
      }
      .pretui-notification-do:hover,
      .pretui-notification-x:hover {
        background: var(--hover, color-mix(in oklch, currentColor 10%, transparent));
      }
      .pretui-notification-x {
        position: relative;
        flex: none;
        display: grid;
        place-items: center;
        inline-size: 1.25rem;
        block-size: 1.25rem;
        border: 0;
        border-radius: var(--radius-control, 6px);
        background: transparent;
        color: var(--muted-foreground);
        cursor: pointer;
      }
      .pretui-notification-x:hover {
        color: var(--foreground);
      }
      .pretui-notification-do:focus-visible,
      .pretui-notification-x:focus-visible {
        outline: 2px solid var(--ring);
        outline-offset: 1px;
      }
      /* Touch: grow the hit area, not the ink. */
      @media (any-pointer: coarse) {
        .pretui-notification-x::after {
          content: '';
          position: absolute;
          inset: 50% auto auto 50%;
          translate: -50% -50%;
          min-inline-size: 44px;
          min-block-size: 44px;
        }
      }
    </style>
  </template>
}
