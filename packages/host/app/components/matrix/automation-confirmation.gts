import Component from '@glimmer/component';

import { Alert } from '@cardstack/pretui/components/alert';
import { KeyValue } from '@cardstack/pretui/components/key-value';
import { LoadingState } from '@cardstack/pretui/components/loading-state';

import type {
  AutomationConfirmation,
  AutomationGate,
} from '@cardstack/host/lib/realm-runner/automations';

interface Signature {
  Args: { gate: AutomationGate };
  Element: HTMLDivElement;
}

interface Shown {
  confirmation: AutomationConfirmation;
  heading: string;
  items: { key: string; value: string }[];
}

const VERBS: Record<AutomationConfirmation['call'], string> = {
  'realm.automations.preview': 'Preview',
  'realm.automations.runNow': 'Run now',
  'realm.automations.switchOn': 'Switch on',
};

// The gate's primary answer names what the click starts: "Switch on End the
// sale" for one automation, the acts in order for several.
export function automationConfirmLabel(
  confirmations: AutomationConfirmation[],
): string {
  if (confirmations.length === 1) {
    let [confirmation] = confirmations;
    return `${VERBS[confirmation.call]} ${confirmation.title ?? confirmation.path}`;
  }
  let verbs = [...new Set(confirmations.map((c) => VERBS[c.call]))];
  let [first, ...rest] = verbs;
  let words = [first, ...rest.map((verb) => verb.toLowerCase())];
  return words.length === 1
    ? `${first} ${confirmations.length} automations`
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function credits(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return 'Unknown';
  }
  let rounded = Math.round(value * 100) / 100;
  return `${rounded.toLocaleString('en-US')} ${rounded === 1 ? 'credit' : 'credits'}`;
}

// What a script's gate asks the reader to confirm for each automation the
// script previews, runs now or switches on: the triggers, the estimate and
// the monthly cap, all as Boxel reads them from the card and the realm
// server, never from the assistant's words.
export default class AutomationConfirmationView extends Component<Signature> {
  get shown(): Shown[] {
    return (this.args.gate.confirmations ?? []).map((confirmation) => {
      let name = confirmation.title ?? confirmation.path;
      let items: { key: string; value: string }[] = [];
      if (confirmation.call === 'realm.automations.switchOn') {
        for (let trigger of confirmation.triggers) {
          items.push({
            key: `Trigger: ${trigger.label}`,
            value: trigger.viewerText
              ? `${trigger.text} · ${trigger.viewerText}`
              : trigger.text,
          });
        }
        items.push(
          {
            key: 'Estimate',
            value:
              confirmation.estimatedCredits === undefined
                ? 'Unknown'
                : `About ${credits(confirmation.estimatedCredits)} a month, by Boxel's estimate`,
          },
          {
            key: 'Monthly cap',
            value: credits(confirmation.monthlyCredits),
          },
          {
            key: 'Payer',
            value:
              'You. Every scheduled run spends your credits, up to the monthly cap.',
          },
        );
      } else {
        items.push(
          {
            key: 'Most a run costs',
            value: credits(confirmation.perRunCredits),
          },
          {
            key: 'Monthly cap',
            value: credits(confirmation.monthlyCredits),
          },
          {
            key: 'Saves',
            value:
              confirmation.call === 'realm.automations.preview'
                ? 'Nothing. A Preview shows what the run would save.'
                : 'Everything the run writes, to the workspace',
          },
          {
            key: 'Outside calls',
            value:
              confirmation.call === 'realm.automations.preview'
                ? 'Boxel makes every outside call and AI request in the script for real, a Preview too. A call that sends, buys or deletes something does so unless the script checks dryRun first.'
                : 'Boxel makes every outside call and AI request in the script.',
          },
          { key: 'Payer', value: 'You. Boxel charges the run to you.' },
        );
      }
      return {
        confirmation,
        heading:
          confirmation.call === 'realm.automations.switchOn'
            ? `Switch on ${name}`
            : confirmation.call === 'realm.automations.preview'
              ? `Preview ${name}`
              : `Run ${name} now`,
        items,
      };
    });
  }

  <template>
    <div class='automation-confirmation' ...attributes>
      {{#if @gate.isLoading}}
        <LoadingState
          @label='Reading the automation from Boxel'
          data-test-automation-confirmation-loading
        />
      {{else}}
        {{#each this.shown as |shown|}}
          <section
            class='automation'
            data-test-automation-confirmation={{shown.confirmation.call}}
          >
            <h4 class='heading'>{{shown.heading}}</h4>
            {{#if shown.confirmation.problem}}
              <Alert
                @tone='danger'
                @title='Boxel can’t show the automation, so the automation can’t run. Deny the call, and tell the assistant why in the chat, so the assistant can fix the card.'
                data-test-automation-confirmation-problem
              >{{shown.confirmation.problem}}</Alert>
            {{else}}
              <KeyValue @items={{shown.items}} @divided={{true}} />
            {{/if}}
          </section>
        {{/each}}
      {{/if}}
    </div>
    <style scoped>
      .automation-confirmation {
        display: grid;
        gap: var(--boxel-sp-sm);
      }
      .automation {
        display: grid;
        gap: var(--boxel-sp-xs);
      }
      .heading {
        margin: 0;
        font: inherit;
        font-weight: 600;
      }
    </style>
  </template>
}
