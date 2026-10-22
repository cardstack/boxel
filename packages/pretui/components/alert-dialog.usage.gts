// Pretui — AlertDialog usage page.
import GlimmerComponent from '@glimmer/component';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { AlertDialog } from './alert-dialog';
import { Button } from './button';
import { FreestyleUsage } from './freestyle-usage';

// ── AlertDialog ──────────────────────────────────────────────────────────

class AlertDialogUsage extends GlimmerComponent {
  @tracked open = false;
  @tracked busy = false;
  @tracked log = '—';

  setOpen = (next: boolean) => (this.open = next);
  confirmed = () => (this.log = 'Deleted 47 records');
  cancelled = () => (this.log = 'Cancelled');
  setBusy = (value: boolean) => (this.busy = value);

  <template>
    <FreestyleUsage
      @name='AlertDialog'
      @description='The destructive confirm, composed from Dialog. Four things separate it from a Dialog and each is a decision rather than a style: it is always modal, an outside click never dismisses it, focus starts on Cancel, and its role is alertdialog so assistive tech is told this interrupts rather than presents. Cancel is FIRST in DOM order, which means the native dialog focusing steps land on the safe choice with no focus() call at all — the platform does the work. Escape is taken in the capture phase, so a host page that also listens for Escape cannot make one keypress mean two things.'
    >
      <:example>
        <div class='oc-row'>
          <AlertDialog
            @open={{this.open}}
            @onOpenChange={{this.setOpen}}
            @title='Delete 47 records?'
            @description='They will be removed from the index immediately and from the archive at the next sweep. This cannot be undone.'
            @confirmLabel='Delete records'
            @cancelLabel='Keep them'
            @busy={{this.busy}}
            @onConfirm={{this.confirmed}}
            @onCancel={{this.cancelled}}
          >
            <:trigger as |isOpen toggle|>
              <Button
                @tone='danger'
                @appearance='outlined'
                {{on 'click' toggle}}
              >{{if isOpen 'Close' 'Delete records…'}}</Button>
            </:trigger>
          </AlertDialog>
          <span class='oc-log'>last action: <strong>{{this.log}}</strong></span>
        </div>
        <p class='oc-hint'>Open it and press Tab once: focus is already on
          <em>Keep them</em>, so the first thing the keyboard can do is the safe
          thing. Click the scrim and nothing happens. Escape cancels.</p>
      </:example>
      <:api as |Args|>
        <Args.Base
          @name='open / onOpenChange / defaultOpen'
          @description='The controlled and uncontrolled halves of one contract. onClose alone is never enough — a parent that can be told the dialog closed but cannot open it has not been given control of it.'
          @hideControls={{true}}
        />
        <Args.String
          @name='title'
          @description='The question. The header block takes markup instead, and either way the element carries the id that aria-labelledby points at.'
          @value='Delete 47 records?'
          @hideControls={{true}}
        />
        <Args.String
          @name='description'
          @description='The consequence, wired as aria-describedby. The default block takes markup instead.'
          @hideControls={{true}}
        />
        <Args.Bool
          @name='busy'
          @description='Holds the dialog open with the confirm button pending. Radix closes on click whether or not the work succeeded, which leaves a failed confirm with no surface to report on. Pending here is React Aria semantics — aria-busy with focus retained, never the native disabled attribute, which would drop focus on the body mid-action.'
          @value={{this.busy}}
          @defaultValue={{false}}
          @onInput={{this.setBusy}}
        />
        <Args.Base
          @name='tone / confirmLabel / cancelLabel / size'
          @description='Tone defaults to danger because that is the pattern; a neutral confirm is the unusual case. The two labels should name the verb, not say Yes and No — a button reading Delete records is answerable without re-reading the question.'
          @hideControls={{true}}
        />
        <Args.Base
          @name='dismissOnEscape'
          @description='Escape cancels by default. Outside clicks NEVER dismiss and that is deliberately not a knob: a stray click must not read as an answer.'
          @hideControls={{true}}
        />
        <Args.Yield
          @name='trigger / header / default / footer'
          @description='The overlay block set. The footer block receives confirm and cancel, so a caller replacing the buttons keeps the wiring. Radix compound children map one to one onto these blocks — AlertDialogTitle is the header block, AlertDialogFooter is the footer block.'
          @hideControls={{true}}
        />
      </:api>
    </FreestyleUsage>

    <style scoped>
      .oc-row {
        display: flex;
        align-items: center;
        gap: var(--space-4, 11px);
        flex-wrap: wrap;
      }
      .oc-log {
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
      .oc-log strong {
        color: var(--foreground);
        font-weight: 600;
      }
      .oc-hint {
        margin: var(--space-4, 11px) 0 0;
        max-width: 62ch;
        font-size: var(--text-ui-sm, 11.5px);
        line-height: 1.6;
        color: var(--muted-foreground);
      }
      .oc-hint em {
        font-style: normal;
        font-weight: 600;
        color: var(--foreground);
      }
    </style>
  </template>
}

export const DEMOS_ALERT_DIALOG: Record<string, unknown> = {
  AlertDialog: AlertDialogUsage,
};
