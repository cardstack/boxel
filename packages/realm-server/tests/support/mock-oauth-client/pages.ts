// Example AI app's pages: Connect, and the result of a flow. Plain HTML with
// its own styles and no assets, so a screenshot needs nothing but the app's
// server. Every value a page shows is escaped.

import {
  EXAMPLE_AI_APP_NAME,
  type FlowOutcome,
  type RegistrationMode,
} from './client.ts';

const MODE_LABELS: Record<RegistrationMode, string> = {
  loopback: 'Registered itself, with a redirect on this computer',
  unverified: 'Registered itself, with a redirect on the web',
  cimd: 'Identified by a client ID metadata document',
};

export function connectPage(mode: RegistrationMode): string {
  return page(
    'Connect',
    `
    <h1>Connect ${EXAMPLE_AI_APP_NAME} to Boxel</h1>
    <p>${EXAMPLE_AI_APP_NAME} can read your Boxel workspaces once you allow it.
    You choose what it may do on Boxel's page, and you can disconnect it at
    any time.</p>
    <a class="button" href="/connect" data-test-connect>Connect Boxel</a>
    ${modeNote(mode)}`,
  );
}

export function resultPage(
  mode: RegistrationMode,
  outcome: FlowOutcome,
): string {
  switch (outcome.kind) {
    case 'connected':
      return page(
        'Connected',
        `
        <h1>Boxel is connected</h1>
        <p>${EXAMPLE_AI_APP_NAME} got a code from Boxel and exchanged it for
        an access token. The token itself is never shown.</p>
        <dl data-test-result="connected">
          <dt>Code</dt>
          <dd data-test-code><code>${escape(outcome.codePreview)}…</code></dd>
          <dt>Scopes</dt>
          <dd data-test-scopes>${outcome.scopes.map((scope) => `<code>${escape(scope)}</code>`).join(' ') || 'None'}</dd>
          <dt>Expires</dt>
          <dd data-test-expires>${escape(describeLifetime(outcome.expiresInSeconds))}</dd>
          <dt>Renews</dt>
          <dd data-test-renews>${
            outcome.refreshTokenIssued
              ? 'Yes: Boxel issued a refresh token'
              : 'No: the connection ends when the token expires'
          }</dd>
        </dl>
        <a class="button secondary" href="/">Back</a>
        ${modeNote(mode)}`,
      );
    case 'denied':
      return page(
        'Not connected',
        `
        <h1>Boxel isn't connected</h1>
        <p data-test-result="denied">You didn't allow ${EXAMPLE_AI_APP_NAME}
        to use your Boxel account.</p>
        <a class="button" href="/connect">Try again</a>
        ${modeNote(mode)}`,
      );
    case 'error':
      return page(
        'Something went wrong',
        `
        <h1>Boxel couldn't be connected</h1>
        <p data-test-result="error">${escape(outcome.message)}</p>
        <a class="button" href="/connect">Try again</a>
        ${modeNote(mode)}`,
      );
  }
}

export function errorPage(message: string): string {
  return page(
    'Something went wrong',
    `
    <h1>Something went wrong</h1>
    <p data-test-result="error">${escape(message)}</p>`,
  );
}

function describeLifetime(seconds: number): string {
  if (seconds % 3600 === 0) {
    let hours = seconds / 3600;
    return `In ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  if (seconds % 60 === 0) {
    let minutes = seconds / 60;
    return `In ${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `In ${seconds} seconds`;
}

function modeNote(mode: RegistrationMode): string {
  return `<p class="note">Test client · ${escape(MODE_LABELS[mode])}</p>`;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${escape(title)} · ${EXAMPLE_AI_APP_NAME}</title>
<style>
  :root {
    color-scheme: light;
    --ink: #1d1f24;
    --muted: #5c616b;
    --line: #dde0e6;
    --accent: #3a5bd9;
    --accent-ink: #ffffff;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 1rem/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Liberation Sans', sans-serif;
    color: var(--ink);
    background: #f4f5f8;
  }
  header {
    display: flex;
    align-items: center;
    gap: 0.625rem;
    padding: 1rem 1.5rem;
    background: #ffffff;
    border-bottom: 1px solid var(--line);
    font-weight: 600;
  }
  .mark {
    display: inline-grid;
    place-items: center;
    width: 1.75rem;
    height: 1.75rem;
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 0.875rem;
  }
  main {
    max-width: 32rem;
    margin: 3rem auto;
    padding: 2rem;
    background: #ffffff;
    border: 1px solid var(--line);
    border-radius: 0.75rem;
  }
  h1 { margin: 0 0 0.75rem; font-size: 1.375rem; line-height: 1.3; }
  p { margin: 0 0 1.25rem; }
  dl {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 0.5rem 1.25rem;
    margin: 0 0 1.5rem;
  }
  dt { color: var(--muted); }
  dd { margin: 0; }
  code {
    font: 0.875rem ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 0.0625rem 0.375rem;
    border-radius: 0.25rem;
    background: #eef0f4;
  }
  .button {
    display: inline-block;
    padding: 0.625rem 1.25rem;
    border-radius: 0.5rem;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 600;
    text-decoration: none;
  }
  .button.secondary {
    background: transparent;
    color: var(--accent);
    border: 1px solid var(--line);
  }
  .button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .note { margin: 1.5rem 0 0; font-size: 0.8125rem; color: var(--muted); }
</style>
</head>
<body>
<header><span class="mark" aria-hidden="true">AI</span>${EXAMPLE_AI_APP_NAME}</header>
<main>${body}</main>
</body>
</html>
`;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
