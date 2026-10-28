// What the key page says about an OAuth key, under its name, from the key
// listing. A connection names the app it signs in through and says when it
// has stopped working: a sign-in the service expired or revoked, which its
// owner fixes by signing in again (Reconnect), or an app that needs an
// administrator, which its owner can't fix themselves. A client gives its
// client id and who signs in through it, and says when the service has
// refused its secret, which replacing the secret fixes.
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { TemplateOnlyComponent } from '@ember/component/template-only';

import Button from '../../components/button.gts';
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
    <div class='oauth' data-test-oauth-connection>
      <div class='detail' data-test-oauth-connection-client>Signs in through
        {{#if @key.oauth.connection.client.label}}
          <strong>{{@key.oauth.connection.client.label}}</strong>
        {{else}}
          an app that is no longer available
        {{/if}}
      </div>
      {{#if (eq @key.oauth.connection.status 'rejected')}}
        <div class='problem' role='status' data-test-oauth-status='rejected'>
          <span>Your sign-in expired or was revoked.</span>
          <Button
            class='action'
            @kind='secondary'
            @size='extra-small'
            aria-describedby='key-name-{{@key.id}}'
            data-test-key-reconnect
            {{on 'click' (fn @onReconnect @key)}}
          ><RefreshCw
              class='action-icon'
              aria-hidden='true'
            />Reconnect</Button>
        </div>
      {{else if (eq @key.oauth.connection.status 'needs-admin')}}
        <div class='problem' role='status' data-test-oauth-status='needs-admin'>
          The app it signs in through needs an administrator.
        </div>
      {{/if}}
    </div>
  {{else if @key.oauth.client}}
    <div class='oauth' data-test-oauth-client>
      <div class='detail'>Client ID
        <span
          class='code'
          data-test-oauth-client-id
        >{{@key.oauth.client.clientId}}</span></div>
      <div class='detail' data-test-oauth-client-grant>
        {{#if (eq @key.oauth.client.grantType 'client_credentials')}}
          No person signs in: Boxel signs in as the app
        {{else}}
          People sign in through it
        {{/if}}
      </div>
      {{#if (eq @key.oauth.client.state 'broken')}}
        <div class='problem' role='status' data-test-oauth-status='broken'>
          Its token endpoint refused the secret: replace it.
        </div>
      {{/if}}
    </div>
  {{/if}}

  <style scoped>
    .oauth {
      display: grid;
      gap: var(--boxel-sp-4xs);
      font-size: var(--boxel-font-size-xs);
      line-height: var(--boxel-line-height-xs);
      overflow-wrap: anywhere;
    }
    .detail {
      color: var(--muted-foreground);
    }
    .detail strong {
      color: var(--foreground);
    }
    .code {
      font-family: var(--boxel-monospace-font-family);
      color: var(--foreground);
    }
    .problem {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--boxel-sp-xs);
      color: var(--destructive-ink, var(--boxel-danger));
      font-weight: 500;
    }
    .action {
      gap: var(--boxel-sp-5xs, 0.25rem);
    }
    .action-icon {
      width: 0.75rem;
      height: 0.75rem;
    }
  </style>
</template>;

export default OAuthKeyStatus;
