/* eslint-env browser */
// OAuth approval lives entirely on the secure origin. Only a provider-issued
// authorization code reaches the client; this window's session never does.
import {
  readConfig,
  storedSession,
  storeSession,
  forgetSession,
} from './session.js';
import { renderSignIn } from './sign-in.js';

function element(tag, text, attributes = {}) {
  let node = document.createElement(tag);
  if (text) {
    node.textContent = text;
  }
  for (let [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}
export async function oauthMode(root) {
  let uid = window.location.pathname.split('/').pop();
  let config = readConfig();
  let session = storedSession();
  if (!session) {
    renderSignIn(root, config, {
      client: 'window',
      resume: { oauthUid: uid },
      onSignedIn(signedIn) {
        storeSession(signedIn);
        oauthMode(root);
      },
    });
    return;
  }
  let card = element('section', '', {
    class: 'secure-card',
    'data-test-oauth-consent': '',
  });
  let error = element('p', '', { role: 'alert', class: 'secure-error' });
  root.replaceChildren(card);
  try {
    let response = await fetch(window.location.pathname, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(
        'This authorization link expired. Start again from your client.',
      );
    }
    let details = await response.json();
    card.append(
      element(
        'h1',
        details.prompt === 'login'
          ? 'Continue with Boxel'
          : 'Allow access to Boxel?',
      ),
    );
    // Treat all registered client metadata as untrusted text.
    card.append(element('p', `Signed in as ${session.user}`));
    card.append(element('p', `${details.clientName} (${details.clientId})`));
    card.append(element('p', `Returns to ${details.redirectHost}`));
    card.append(
      element('p', `Service: ${details.resourceName} (${details.resource})`),
    );
    card.append(element('p', `Requested access: ${details.scopes.join(', ')}`));
    let choices = details.realms.map((realm) => {
      let label = element('label', '', { class: 'secure-field' });
      let checkbox = element('input', '', { type: 'checkbox', value: realm });
      checkbox.checked = true;
      label.append(checkbox, document.createTextNode(realm));
      if (details.prompt === 'consent') {
        card.append(label);
      }
      return checkbox;
    });
    let remember;
    if (
      details.prompt === 'consent' &&
      details.scopes.includes('offline_access')
    ) {
      card.append(
        element(
          'p',
          'This connection can renew automatically for up to 30 days. You can revoke access in Connected applications.',
        ),
      );
    } else if (details.prompt === 'consent' && details.canRefresh) {
      let label = element('label', '', { class: 'secure-field' });
      remember = element('input', '', { type: 'checkbox' });
      label.append(
        remember,
        document.createTextNode(
          'Keep connected for up to 30 days with automatic renewal. You can revoke access in Connected applications.',
        ),
      );
      card.append(label);
    }
    let allow = element(
      'button',
      details.prompt === 'login' ? 'Continue' : 'Allow selected realms',
      { class: 'secure-button', type: 'button', 'data-test-oauth-allow': '' },
    );
    let deny = element('button', 'Deny', {
      class: 'secure-button secondary',
      type: 'button',
      'data-test-oauth-deny': '',
    });
    let submit = async (decision) => {
      allow.disabled = deny.disabled = true;
      error.textContent = '';
      try {
        let answer = await fetch(window.location.pathname, {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.token}`,
          },
          body: JSON.stringify({
            decision,
            ...(remember ? { remember: remember.checked } : {}),
            realms: choices
              .filter((input) => input.checked)
              .map((input) => input.value),
          }),
        });
        if (!answer.ok) {
          if (answer.status === 401) {
            forgetSession();
            oauthMode(root);
            return;
          }
          throw new Error(
            'Access could not be approved. Check your realm access or start again.',
          );
        }
        let { redirectTo } = await answer.json();
        // Only navigate to the provider's own resume endpoint. It validates
        // the registered client redirect before issuing an OAuth code.
        let target = new URL(redirectTo, window.location.origin);
        if (
          target.origin !== window.location.origin ||
          !target.pathname.startsWith('/oauth/authorize/')
        ) {
          throw new Error('Invalid authorization response');
        }
        window.location.assign(target.href);
      } catch (e) {
        error.textContent = e.message;
        allow.disabled = deny.disabled = false;
      }
    };
    allow.addEventListener('click', () => submit('allow'));
    deny.addEventListener('click', () => submit('deny'));
    card.append(error, allow, deny);
  } catch (e) {
    card.append(error);
    error.textContent = e.message;
  }
}

export async function oauthGrantsMode(root) {
  let config = readConfig();
  let session = storedSession();
  if (!session) {
    renderSignIn(root, config, {
      client: 'window',
      resume: { mode: 'connected-apps' },
      onSignedIn(value) {
        storeSession(value);
        oauthGrantsMode(root);
      },
    });
    return;
  }
  let card = element('section', '', { class: 'secure-card' });
  card.append(element('h1', 'Connected applications'));
  let error = element('p', '', { role: 'alert', class: 'secure-error' });
  card.append(error);
  root.replaceChildren(card);
  try {
    let response = await fetch('/oauth/grants', {
      credentials: 'same-origin',
      headers: { Authorization: `Bearer ${session.token}` },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Sign in again to manage connected applications.');
    }
    let grants = await response.json();
    if (!grants.length) {
      card.append(element('p', 'No connected applications.'));
    }
    for (let grant of grants) {
      let row = element('section');
      row.append(
        element('h2', grant.client_id),
        element('p', grant.resource),
        element('p', grant.realms.join(', ')),
      );
      let revoke = element('button', 'Revoke access', {
        type: 'button',
        class: 'secure-button secondary',
      });
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try {
          let answer = await fetch('/oauth/grants', {
            method: 'DELETE',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({ id: grant.id }),
          });
          if (!answer.ok) {
            throw new Error('Access could not be revoked. Try again.');
          }
          oauthGrantsMode(root);
        } catch (e) {
          error.textContent = e.message;
          revoke.disabled = false;
        }
      });
      row.append(revoke);
      card.append(row);
    }
  } catch (e) {
    error.textContent = e.message;
  }
}
