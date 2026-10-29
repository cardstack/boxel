// Picks the app an account is connected through, as a row of a card's edit
// format: each client a tile to click, as the key picker draws keys, saying
// whose app it is, the host whose sign-in page it opens, and each permission
// it asks for. Everything a tile shows is the realm server's description of
// the client; the page that opened the window names none of it.
import { fn } from '@ember/helper';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import FieldContainer from '../../components/field-container.gts';
import Globe from '../../components/icons/globe.gts';
import RadioTile from '../../components/radio-tile.gts';
import { eq, gt } from '../../helpers/truth-helpers.ts';

import { scopesOf, type ConnectableClient } from './context.ts';

// Whose app a client is, in the words the tile uses.
export function clientOwner(
  kind: ConnectableClient['kind'] | undefined,
  realmName?: string,
): string {
  switch (kind) {
    case 'platform':
      return 'Boxel';
    case 'share':
      return realmName ? `Shared in ${realmName}` : 'Shared in this workspace';
    case 'own':
      return 'Your app';
    default:
      return '';
  }
}

interface Signature {
  Args: {
    clients: ConnectableClient[];
    // The index of the chosen client in `clients`.
    selected: number | undefined;
    onSelect: (index: number) => void;
    // The name of the realm a shared client is shared in.
    realmName?: string;
  };
}

const ClientPicker: TemplateOnlyComponent<Signature> = <template>
  <FieldContainer
    @tag='div'
    @label='Sign in with'
    @icon={{Globe}}
    data-test-client-picker
  >
    <fieldset class='picker'>
      <legend
        class={{if (gt @clients.length 1) 'prompt' 'visually-hidden'}}
      >Select an app</legend>
      {{#each @clients as |client index|}}
        <RadioTile
          @name='client'
          @value={{index}}
          @checked={{eq @selected index}}
          @onChange={{fn @onSelect index}}
          data-test-client-choice={{client.label}}
        >
          <div class='tile'>
            <div class='label' data-test-client-label>{{client.label}}</div>
            <div class='meta'>
              <span data-test-client-owner>{{clientOwner
                  client.kind
                  @realmName
                }}</span>
              · Signs in at
              <span
                class='host'
                data-test-client-host
              >{{client.authorizeHost}}</span>
            </div>
            {{#let (scopesOf client.scopes) as |scopes|}}
              {{#if scopes.length}}
                <div class='permissions-heading'>It asks for:</div>
                <ul class='permissions' data-test-client-permissions>
                  {{#each scopes as |scope|}}
                    <li data-test-client-permission>{{scope}}</li>
                  {{/each}}
                </ul>
              {{else}}
                <div class='no-permissions' data-test-client-no-permissions>No
                  extra permissions requested</div>
              {{/if}}
            {{/let}}
          </div>
        </RadioTile>
      {{/each}}
    </fieldset>
  </FieldContainer>

  <style scoped>
    .picker {
      margin: 0;
      padding: 0;
      border: 0;
      display: grid;
      gap: var(--boxel-sp-xs);
      min-width: 0;
    }
    .prompt {
      padding: 0;
      margin-bottom: var(--boxel-sp-xs);
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      color: var(--muted-foreground);
    }
    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .tile {
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      overflow-wrap: anywhere;
    }
    .label {
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-line-height-sm);
      font-weight: 600;
    }
    .meta,
    .permissions-heading,
    .no-permissions {
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      color: var(--muted-foreground);
    }
    .host {
      font-family: var(--boxel-monospace-font-family);
      color: var(--foreground);
    }
    .permissions-heading,
    .no-permissions {
      margin-top: var(--boxel-sp-xs);
    }
    .permissions {
      margin: var(--boxel-sp-4xs) 0 0;
      padding-inline-start: var(--boxel-sp-lg);
      font-family: var(--boxel-monospace-font-family);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
    }
  </style>
</template>;

export default ClientPicker;
