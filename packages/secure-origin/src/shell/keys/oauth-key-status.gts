// What the key page says about an OAuth key, as the first rows of its
// details, from the key listing. A connection names the app it signs in through and says when it
// has stopped working: a sign-in the service expired or revoked, which its
// owner fixes by signing in again (Reconnect), or an app that needs an
// administrator, which its owner can't fix themselves. A client gives its
// client id and who signs in through it, and says when the service has
// refused its secret, which replacing the secret fixes.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
import KeyRound from '../../components/icons/key-round.gts';
import RectangleEllipsis from '../../components/icons/rectangle-ellipsis.gts';
import RefreshCw from '../../components/icons/refresh-cw.gts';
import { eq } from '../../helpers/truth-helpers.ts';

import type { UserKey } from './context.ts';

interface Signature {
  Args: {
    key: UserKey;
    onReconnect: (key: UserKey) => void;
  };
}

const OAuthKeyStatus: TemplateOnlyComponent<Signature> = <template>
  {{#if @key.oauth.connection}}
    <div class='row' data-test-oauth-connection>
      <KeyRound class='row-icon' aria-hidden='true' />
      <p class='row-text' data-test-oauth-connection-client>Signs in with
        {{#if @key.oauth.connection.client.label}}
          <strong>{{@key.oauth.connection.client.label}}</strong>
        {{else}}
          an app that is no longer available
        {{/if}}
      </p>
    </div>
    {{#if (eq @key.oauth.connection.status 'rejected')}}
      <div class='alert' role='status' data-test-oauth-status='rejected'>
        <p class='alert-text'>Your sign-in expired or was cancelled on the site.
          Sign in again to keep using this account.</p>
        <Button
          class='action'
          @kind='secondary'
          @size='extra-small'
          aria-describedby='key-name-{{@key.id}}'
          data-test-key-reconnect
          {{on 'click' (fn @onReconnect @key)}}
        ><RefreshCw class='action-icon' aria-hidden='true' />Reconnect</Button>
      </div>
    {{else if (eq @key.oauth.connection.status 'needs-admin')}}
      <div class='alert' role='status' data-test-oauth-status='needs-admin'>
        <p class='alert-text'>The app this account signs in with needs its owner
          to fix it. Ask whoever added the app.</p>
      </div>
    {{/if}}
  {{else if @key.oauth.client}}
    <div class='row' data-test-oauth-client>
      <RectangleEllipsis class='row-icon' aria-hidden='true' />
      <p class='row-text'>Client ID
        <span
          class='code'
          data-test-oauth-client-id
        >{{@key.oauth.client.clientId}}</span>
        {{#if (eq @key.oauth.client.grantType 'client_credentials')}}
          <span class='muted' data-test-oauth-client-grant>· Signs in as itself,
            with no person’s account</span>
        {{/if}}
      </p>
    </div>
    {{#if (eq @key.oauth.client.state 'broken')}}
      <div class='alert' role='status' data-test-oauth-status='broken'>
        <p class='alert-text'>The site refused this app’s secret. Replace it
          with the app’s current secret.</p>
      </div>
    {{/if}}
  {{/if}}
  <style scoped>
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      column-gap: var(--boxel-sp-xs);
      align-items: start;
    }
    .row-icon {
      width: 0.875rem;
      height: 0.875rem;
      margin-top: 0.1875rem;
      color: var(--muted-foreground);
    }
    .row-text {
      margin: 0;
      overflow-wrap: anywhere;
    }
    .row-text strong {
      font-weight: 600;
    }
    .code {
      font-family: var(--boxel-monospace-font-family);
    }
    .muted {
      color: var(--muted-foreground);
    }
    /* A problem stands apart from the details: its own tinted box, with
       room around the action it offers. */
    .alert {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: var(--boxel-sp-xs);
      padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
      border-radius: var(--boxel-border-radius-sm);
      background-color: color-mix(
        in oklab,
        var(--destructive, var(--boxel-danger)) 8%,
        transparent
      );
      color: var(--destructive-ink, var(--boxel-danger));
    }
    .alert-text {
      flex: 1 1 14rem;
      margin: 0;
      font-weight: 500;
    }
    .action {
      flex-shrink: 0;
      gap: var(--boxel-sp-5xs, 0.25rem);
    }
    .action-icon {
      width: 0.75rem;
      height: 0.75rem;
    }
  </style>
</template>;

export default OAuthKeyStatus;
