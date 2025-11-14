import type { SafeString } from '@ember/template';

import Component from '@glimmer/component';

import type MessageCommand from '@cardstack/host/lib/matrix-classes/message-command';

import { sanitizedHtml } from '@cardstack/host/helpers/sanitized-html';

interface Signature {
  Args: {
    body?: SafeString | string | null;
    commands?: MessageCommand[];
  };
  Blocks: {
    default: [];
  };
}

export default class PatchSummary extends Component<Signature> {
  get summaryBody() {
    return this.args.body ?? '';
  }

  get hasCommands() {
    return (this.args.commands?.length ?? 0) > 0;
  }

  <template>
    <article class='patch-summary' data-test-ai-patch-summary>
      {{!-- <header>Update Summary</header>
      <div class='patch-summary-body'>
        {{sanitizedHtml this.summaryBody}}
      </div> --}}
      {{#if this.hasCommands}}
        <div class='patch-summary-commands' data-test-ai-patch-summary-commands>
          {{! <div class='commands-title'>
            Follow-up checks
          </div> }}
          <div class='commands-content'>
            {{yield}}
          </div>
        </div>
      {{/if}}
    </article>

    <style scoped>
      .patch-summary {
        background: transparent;
        border: 1px solid var(--boxel-blue-400);
        border-radius: var(--boxel-border-radius-md);
        /* padding: var(--boxel-sp-xs);*/
        font-size: var(--boxel-font-size-xs);
        line-height: 1.4;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.05) inset;
        width: 100%;
        box-sizing: border-box;
      }

      header {
        font-weight: var(--boxel-font-weight-semibold);
        text-transform: uppercase;
        font-size: var(--boxel-font-size-2xs);
        letter-spacing: 0.08em;
        color: var(--boxel-blue-200);
        margin-bottom: var(--boxel-sp-xxs);
      }

      .patch-summary-body {
        margin-bottom: var(--boxel-lg);
      }

      .patch-summary-commands {
        margin-top: var(--boxel-lg);
        border-top: 1px solid var(--boxel-blue-500);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      .commands-title {
        font-weight: var(--boxel-font-weight-semibold);
        text-transform: uppercase;
        font-size: var(--boxel-font-size-2xs);
        letter-spacing: 0.08em;
        color: var(--boxel-blue-200);
      }

      .commands-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
    </style>
  </template>
}
