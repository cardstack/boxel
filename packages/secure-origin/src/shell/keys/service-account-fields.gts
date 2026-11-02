// The fields a Google service account is entered in, as rows of a card's edit
// format: its JSON key file, chosen from disk, then the user to act as
// (optional, for domain-wide delegation) and the scopes its tokens ask for.
// Once a file is chosen the row names the service account it holds, so the
// user can see it is the one they meant; nothing else from the file is shown.
//
// On a replace the fields say what the replacement changes: that Act as and
// Scopes start as the key has them now, or else that all three are set anew,
// and when the chosen file is for another service account than the key's,
// that delegation and scopes were granted to the old one.
import { on } from '@ember/modifier';
import Component from '@glimmer/component';

import FieldContainer from '../../components/field-container.gts';
import Globe from '../../components/icons/globe.gts';
import KeyRound from '../../components/icons/key-round.gts';
import Tag from '../../components/icons/tag.gts';
import BoxelInput from '../../components/input.gts';

import type { ServiceAccountDetails } from './context.ts';
import type { ServiceAccountEntry } from './service-account-entry.ts';

// What a replace knows about the key it replaces: its details, when known,
// and whether the fields started from them.
export interface ServiceAccountReplacing {
  current?: ServiceAccountDetails;
  prefilled: boolean;
}

interface Signature {
  Args: {
    entry: ServiceAccountEntry;
    onChange?: () => void;
    // Given on a replace, once the page knows what the key is now.
    replacing?: ServiceAccountReplacing;
  };
}

export default class ServiceAccountFields extends Component<Signature> {
  <template>
    {{#if @replacing}}
      {{#if @replacing.prefilled}}
        <p class='replace-note' data-test-service-account-replace-note>Choose
          the new key file.
          <strong>Act as</strong>
          and
          <strong>Scopes</strong>
          start as the key has them now: the replacement keeps them as you leave
          them here.</p>
      {{else}}
        <p class='replace-note' data-test-service-account-replace-note>A
          replacement sets the key file, the scopes and who it acts as all anew.
          Enter the scopes again, and leave
          <strong>Act as</strong>
          empty only if it should act as the service account itself.</p>
      {{/if}}
    {{/if}}
    <FieldContainer
      @tag='div'
      @label='Key file'
      @icon={{KeyRound}}
      data-test-key-field='key-file'
    >
      <div class='file'>
        <label class='choose'>
          <input
            class='file-input'
            type='file'
            accept='.json,application/json'
            data-test-service-account-file
            {{on 'change' this.chooseFile}}
          />
          <span class='choose-button'>{{if
              @entry.fileName
              'Choose another file'
              'Choose the JSON key file'
            }}</span>
        </label>
        {{#if @entry.clientEmail}}
          <p class='chosen' data-test-service-account-email>
            Service account
            <strong>{{@entry.clientEmail}}</strong>
            <span class='file-name'>from {{@entry.fileName}}</span>
          </p>
        {{else if @entry.fileProblem}}
          <p
            class='problem'
            role='alert'
            data-test-service-account-problem
            data-test-service-account-problem-file={{@entry.fileName}}
          >
            {{@entry.fileProblem}}
          </p>
        {{else}}
          <p class='hint'>In the Google Cloud console, under IAM &amp; Admin →
            Service Accounts → Keys, add a key of type JSON.</p>
        {{/if}}
      </div>
    </FieldContainer>
    <FieldContainer
      @tag='label'
      @label='Act as'
      @icon={{Tag}}
      data-test-key-field='subject'
    >
      <div class='with-hint'>
        <BoxelInput
          @type='email'
          @autocomplete='off'
          @placeholder='Optional: someone@your-domain.com'
          @value={{@entry.subject}}
          @onInput={{this.setSubject}}
          name='service-account-subject'
          data-test-service-account-subject
        />
        <p class='hint'>Only for a service account with domain-wide delegation.
          Leave it empty to act as the service account itself.</p>
      </div>
    </FieldContainer>
    <FieldContainer
      @tag='label'
      @label='Scopes'
      @icon={{Globe}}
      data-test-key-field='scopes'
    >
      <div class='with-hint'>
        <BoxelInput
          @type='textarea'
          @autocomplete='off'
          @placeholder='https://www.googleapis.com/auth/spreadsheets'
          @value={{@entry.scopes}}
          @onInput={{this.setScopes}}
          name='service-account-scopes'
          spellcheck='false'
          data-test-service-account-scopes
        />
        <p class='hint'>What its tokens may do, one per line, or separated by
          spaces.</p>
      </div>
    </FieldContainer>
    {{#if this.accountChange}}
      <p
        class='replace-note'
        role='status'
        data-test-service-account-changed
      >This key file is for
        <strong>{{this.accountChange.to}}</strong>, not
        <strong>{{this.accountChange.from}}</strong>. Delegation and scopes are
        granted per service account, so check
        <strong>Act as</strong>
        and
        <strong>Scopes</strong>
        for the new one.</p>
    {{/if}}

    <style scoped>
      .replace-note {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: var(--boxel-line-height-sm);
        overflow-wrap: anywhere;
      }
      .file,
      .with-hint {
        display: grid;
        gap: var(--boxel-sp-xxs);
        min-width: 0;
      }
      .choose {
        position: relative;
        width: fit-content;
        cursor: pointer;
      }
      .file-input {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
      }
      .choose-button {
        display: inline-flex;
        align-items: center;
        min-height: 2.25rem;
        padding: 0 var(--boxel-sp);
        border-radius: var(--boxel-border-radius);
        border: 1px solid var(--border, var(--boxel-400));
        background-color: var(--background, var(--boxel-light));
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
      }
      .choose:hover .choose-button {
        border-color: var(--foreground, var(--boxel-dark));
      }
      .choose:has(.file-input:focus-visible) .choose-button {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .chosen,
      .hint,
      .problem {
        margin: 0;
        font-size: var(--boxel-font-size-xs);
        line-height: var(--boxel-line-height-xs);
        overflow-wrap: anywhere;
      }
      .hint,
      .file-name {
        color: var(--muted-foreground);
      }
      .problem {
        color: var(--destructive-ink, var(--boxel-danger));
        font-weight: 500;
      }
    </style>
  </template>

  // The service account a chosen key file is for, when it isn't the one the
  // key is now.
  private get accountChange(): { from: string; to: string } | undefined {
    let from = this.args.replacing?.current?.email;
    let to = this.args.entry.clientEmail;
    return from && to && from !== to ? { from, to } : undefined;
  }

  private chooseFile = async (event: Event) => {
    let input = event.target as HTMLInputElement;
    await this.args.entry.readFile(input.files?.[0]);
    // The page holds what it read; the input itself is emptied, so the file
    // isn't kept in the form.
    input.value = '';
    this.args.onChange?.();
  };

  private setSubject = (value: string) => {
    this.args.entry.subject = value;
    this.args.onChange?.();
  };

  private setScopes = (value: string) => {
    this.args.entry.scopes = value;
    this.args.onChange?.();
  };
}
