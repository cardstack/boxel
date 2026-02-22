import { CardDef, Component } from 'https://cardstack.com/base/card-api';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import CreateListingPRRequestCommand from '@cardstack/boxel-host/commands/create-listing-pr-request';
import CreateShowCardRequestCommand from './commands/create-show-card-request';
import CreatePatchCardInstanceRequestCommand from './commands/create-patch-card-instance-request';
import { Button } from '@cardstack/boxel-ui/components';

type CommandTab = 'show-card' | 'patch-card-instance' | 'create-listing-pr';

const DEFAULT_LISTING_ID = '95cbe2c7-9b60-4afd-8a3c-1382b610e316';

class Isolated extends Component<typeof BotRequestDemo> {
  @tracked isSubmitting = false;
  @tracked statusMessage: string | null = null;
  @tracked errorMessage: string | null = null;
  @tracked activeTab: CommandTab = 'show-card';

  get hasCommandContext() {
    return Boolean(this.args.context?.commandContext);
  }

  get isSubmitDisabled() {
    return this.isSubmitting || !this.hasCommandContext;
  }

  get isShowCardTab() {
    return this.activeTab === 'show-card';
  }

  get isCreateListingPRTab() {
    return this.activeTab === 'create-listing-pr';
  }

  get isPatchCardInstanceTab() {
    return this.activeTab === 'patch-card-instance';
  }

  get experimentsRealmURL() {
    return new URL('./', import.meta.url).href;
  }

  get catalogRealmURL() {
    return new URL('../catalog/', this.experimentsRealmURL).href;
  }

  get showCardId() {
    return new URL('./Author/jane-doe', this.experimentsRealmURL).href;
  }

  get showCardTargetRealm() {
    return this.experimentsRealmURL;
  }

  get showCardFormat() {
    return 'isolated';
  }

  get listingId() {
    return new URL(`./AppListing/${DEFAULT_LISTING_ID}`, this.catalogRealmURL)
      .href;
  }

  get createListingPRTargetRealm() {
    return this.experimentsRealmURL;
  }

  get patchCardPatch() {
    return {
      attributes: {
        quote: 'Bot Request Patch',
      },
    };
  }

  get activeCommandDisplayName() {
    if (this.isShowCardTab) {
      return 'show-card';
    }
    if (this.isPatchCardInstanceTab) {
      return 'patch-card-instance';
    }
    return 'create-listing-pr';
  }

  get activeCommandInput() {
    if (this.isShowCardTab) {
      return {
        cardId: this.showCardId,
        format: this.showCardFormat,
        realm: this.showCardTargetRealm,
      };
    }
    if (this.isPatchCardInstanceTab) {
      return {
        cardId: this.showCardId,
        patch: this.patchCardPatch,
        realm: this.showCardTargetRealm,
      };
    }

    return {
      realm: this.createListingPRTargetRealm,
      listingId: this.listingId,
    };
  }

  get hardcodedInputsPreview() {
    return JSON.stringify(
      {
        command: this.activeCommandDisplayName,
        input: this.activeCommandInput,
      },
      null,
      2,
    );
  }

  get payloadPreview() {
    if (this.isShowCardTab) {
      return JSON.stringify(
        {
          type: 'app.boxel.bot-trigger',
          content: {
            type: 'show-card',
            realm: this.showCardTargetRealm,
            input: {
              cardId: this.showCardId,
              format: this.showCardFormat,
            },
          },
        },
        null,
        2,
      );
    }

    if (this.isPatchCardInstanceTab) {
      return JSON.stringify(
        {
          type: 'app.boxel.bot-trigger',
          content: {
            type: 'patch-card-instance',
            realm: this.showCardTargetRealm,
            input: {
              cardId: this.showCardId,
              patch: this.patchCardPatch,
              roomId: '<resolved room id>',
            },
          },
        },
        null,
        2,
      );
    }

    return JSON.stringify(
      {
        type: 'app.boxel.bot-trigger',
        content: {
          type: 'create-listing-pr',
          realm: this.createListingPRTargetRealm,
          input: {
            roomId: '<resolved room id>',
            realm: this.createListingPRTargetRealm,
            listingId: this.listingId,
          },
        },
      },
      null,
      2,
    );
  }

  get commandURLPreview() {
    if (this.isShowCardTab) {
      return '@cardstack/boxel-host/commands/show-card/default';
    }
    if (this.isPatchCardInstanceTab) {
      return '@cardstack/boxel-host/commands/patch-card-instance/default';
    }

    return '@cardstack/boxel-host/commands/create-listing-pr/default';
  }

  get codeRef() {
    if (this.isShowCardTab) {
      return {
        module: '@cardstack/boxel-host/commands/show-card',
        name: 'default',
      };
    }
    if (this.isPatchCardInstanceTab) {
      return {
        module: '@cardstack/boxel-host/commands/patch-card-instance',
        name: 'default',
      };
    }

    return {
      module: '@cardstack/boxel-host/commands/create-listing-pr',
      name: 'default',
    };
  }

  get codeRefPreview() {
    return JSON.stringify(this.codeRef, null, 2);
  }

  get commandRunnerURL() {
    let hostOrigin =
      typeof window !== 'undefined'
        ? window.location.origin
        : new URL(this.showCardId).origin;
    let nonce = 'demo';
    let encodedCommand = encodeURIComponent(
      `${this.codeRef.module}/${this.codeRef.name}`,
    );
    let encodedInput = encodeURIComponent(
      JSON.stringify(this.activeCommandInput ?? null),
    );
    return `${hostOrigin}/command-runner/${encodedCommand}/${encodedInput}/${encodeURIComponent(nonce)}`;
  }

  get sendButtonLabel() {
    if (this.isShowCardTab) {
      return 'Send Show Card Bot Request';
    }
    if (this.isPatchCardInstanceTab) {
      return 'Send Patch Card Instance Bot Request';
    }
    return 'Send Create Listing PR Request';
  }

  @action
  clearMessages() {
    this.statusMessage = null;
    this.errorMessage = null;
  }

  @action
  selectShowCardTab() {
    this.activeTab = 'show-card';
    this.clearMessages();
  }

  @action
  selectCreateListingPRTab() {
    this.activeTab = 'create-listing-pr';
    this.clearMessages();
  }

  @action
  selectPatchCardInstanceTab() {
    this.activeTab = 'patch-card-instance';
    this.clearMessages();
  }

  @action
  async requestShowCard() {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }

    await new CreateShowCardRequestCommand(commandContext).execute({
      cardId: this.showCardId,
      format: this.showCardFormat,
      realm: this.showCardTargetRealm,
    });
  }

  @action
  async requestCreateListingPR() {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }

    await new CreateListingPRRequestCommand(commandContext).execute({
      realm: this.createListingPRTargetRealm,
      listingId: this.listingId,
    });
  }

  @action
  async requestPatchCardInstance() {
    let commandContext = this.args.context?.commandContext;
    if (!commandContext) {
      this.errorMessage =
        'Command context is unavailable. Open this card in host interact mode.';
      return;
    }

    await new CreatePatchCardInstanceRequestCommand(commandContext).execute({
      cardId: this.showCardId,
      patch: this.patchCardPatch,
      realm: this.showCardTargetRealm,
    });
  }

  @action
  async sendActiveRequest() {
    this.clearMessages();
    this.isSubmitting = true;

    try {
      if (this.isShowCardTab) {
        await this.requestShowCard();
        this.statusMessage =
          'Show Card request sent. A room was created/opened automatically.';
      } else if (this.isPatchCardInstanceTab) {
        await this.requestPatchCardInstance();
        this.statusMessage =
          'Patch Card Instance request sent. A room was created/opened automatically.';
      } else {
        await this.requestCreateListingPR();
        this.statusMessage =
          'Create Listing PR request sent. A room was created/opened automatically.';
      }
    } catch (error) {
      this.errorMessage =
        error instanceof Error
          ? error.message
          : 'Failed to send bot-runner request.';
    } finally {
      this.isSubmitting = false;
    }
  }

  <template>
    <article class='bot-request-demo'>
      <header>
        <h2>Bot Request Demo</h2>
        <p>
          Harness card with tabs for
          <code>show-card</code>
          ,
          <code>patch-card-instance</code>
          and
          <code>create-listing-pr</code>
          using hardcoded inputs derived from relative realm URLs.
        </p>
      </header>

      <section class='tabs' role='tablist' aria-label='Command tabs'>
        <button
          type='button'
          class={{if this.isShowCardTab 'tab tab--active' 'tab'}}
          {{on 'click' this.selectShowCardTab}}
        >
          show-card
        </button>
        <button
          type='button'
          class={{if this.isPatchCardInstanceTab 'tab tab--active' 'tab'}}
          {{on 'click' this.selectPatchCardInstanceTab}}
        >
          patch-card-instance
        </button>
        <button
          type='button'
          class={{if this.isCreateListingPRTab 'tab tab--active' 'tab'}}
          {{on 'click' this.selectCreateListingPRTab}}
        >
          create-listing-pr
        </button>
      </section>

      <section class='actions'>
        <Button
          data-test-send-bot-request
          @disabled={{this.isSubmitDisabled}}
          {{on 'click' this.sendActiveRequest}}
        >
          {{this.sendButtonLabel}}
        </Button>
      </section>

      <section class='payload payload--active'>
        <h3>Active Command</h3>
        <pre>{{this.activeCommandDisplayName}}</pre>
      </section>

      <section class='payload'>
        <h3>Hardcoded Inputs</h3>
        <pre>{{this.hardcodedInputsPreview}}</pre>
      </section>

      <section class='payload'>
        <h3>Expected Event Payload</h3>
        <pre>{{this.payloadPreview}}</pre>
      </section>

      <section class='payload'>
        <h3>Resolved Command</h3>
        <p class='hint'>
          Bot registration command reference:
        </p>
        <pre>{{this.commandURLPreview}}</pre>
        <p class='hint'>
          Resolved codeRef:
        </p>
        <pre>{{this.codeRefPreview}}</pre>
      </section>

      <section class='payload'>
        <h3>Command Runner URL</h3>
        <pre>{{this.commandRunnerURL}}</pre>
        <a
          class='runner-link'
          href={{this.commandRunnerURL}}
          rel='noopener noreferrer'
          target='_blank'
        >
          Open command-runner URL
        </a>
      </section>

      {{#if this.statusMessage}}
        <p class='status status--success'>{{this.statusMessage}}</p>
      {{/if}}

      {{#if this.errorMessage}}
        <p class='status status--error'>{{this.errorMessage}}</p>
      {{/if}}
    </article>

    <style scoped>
      .bot-request-demo {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
      }
      header p {
        margin: var(--boxel-sp-xs) 0 0;
        color: var(--boxel-700);
      }
      .tabs {
        display: flex;
        gap: var(--boxel-sp-sm);
        flex-wrap: wrap;
      }
      .tab {
        border: 1px solid var(--boxel-200);
        background: var(--boxel-50);
        color: var(--boxel-700);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-sm);
        cursor: pointer;
      }
      .tab--active {
        border-color: var(--boxel-link);
        background: color-mix(in srgb, var(--boxel-link) 10%, white);
        color: var(--boxel-link);
      }
      .hint {
        margin: 0;
        font-size: var(--boxel-font-xs);
        color: var(--boxel-600);
      }
      .payload {
        border: 1px solid var(--boxel-200);
        border-radius: var(--boxel-border-radius-lg);
        padding: var(--boxel-sp);
        background: var(--boxel-50);
      }
      .payload--active {
        border-color: var(--boxel-link);
      }
      pre {
        margin: var(--boxel-sp-xs) 0 0;
        white-space: pre-wrap;
        font-family: var(--boxel-font-monospace);
        font-size: var(--boxel-font-sm);
      }
      .runner-link {
        display: inline-block;
        margin-top: var(--boxel-sp-sm);
        color: var(--boxel-link);
      }
      .actions {
        display: flex;
        gap: var(--boxel-sp);
        flex-wrap: wrap;
      }
      .status {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
      }
      .status--success {
        background: color-mix(in srgb, var(--boxel-success) 12%, white);
        color: var(--boxel-success);
      }
      .status--error {
        background: color-mix(in srgb, var(--boxel-error-100) 12%, white);
        color: var(--boxel-error-100);
      }
    </style>
  </template>
}

export class BotRequestDemo extends CardDef {
  static displayName = 'Bot Request Demo';

  static isolated = Isolated;
}
