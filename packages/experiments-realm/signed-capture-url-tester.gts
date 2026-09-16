import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';
import { fn } from '@ember/helper';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

import { realmURL } from '@cardstack/runtime-common';
import { Button } from '@cardstack/boxel-ui/components';

// Interactive harness for the signed-capture-URL flow: mint tokens for a
// linked card's capture URLs via the realm's `_sign-capture-urls` endpoint,
// then exercise the browser surfaces the auth service worker cannot reach —
// a top-level navigation (Open buttons) and an <object> PDF embed. On a
// private realm the bare URL draws a 401 while the signed variant serves;
// on a public realm both work.
//
// This is a diagnostic card, not a pattern to copy: it reads the per-realm
// session JWT straight out of localStorage because the service worker only
// injects Authorization on GET/HEAD and no host minting affordance exists
// yet. Real cards will go through the host capture-url-signer service once
// it ships.

interface SignedEntry {
  url: string;
  signedUrl: string;
  expiresAt: string | null;
}

interface Variant {
  key: string;
  label: string;
  qs: string;
}

const VARIANTS: Variant[] = [
  { key: 'png', label: 'PNG (default capture)', qs: '' },
  { key: 'pdf', label: 'PDF', qs: '?type=pdf' },
  { key: 'pdf-print', label: 'PDF (print media)', qs: '?type=pdf&media=print' },
];

function shortenToken(url: string): string {
  let u = new URL(url);
  let token = u.searchParams.get('token');
  if (token && token.length > 16) {
    u.searchParams.set('token', token.slice(0, 12) + '…');
  }
  return decodeURIComponent(u.href);
}

class Isolated extends Component<typeof SignedCaptureUrlTester> {
  @tracked isRunning = false;
  @tracked errorMessage: string | null = null;
  @tracked signed: SignedEntry[] | null = null;
  @tracked rawResponse: string | null = null;

  get targetCard() {
    return (this.args.model as any)?.card;
  }

  get targetRealm(): string | undefined {
    return this.targetCard?.[realmURL]?.href;
  }

  get hasLinkedCard() {
    return Boolean(this.targetCard?.id);
  }

  get variants(): (Variant & { durableUrl: string })[] {
    let card = this.targetCard;
    let realm = this.targetRealm;
    let id: string | undefined = card?.id;
    if (!id || !realm) {
      return [];
    }
    let path = id.slice(realm.length);
    return VARIANTS.map((v) => ({
      ...v,
      durableUrl: `${realm}_screenshot/${path}${v.qs}`,
    }));
  }

  get rows() {
    return this.variants.map((v) => {
      let entry = this.signed?.find((s) => s.url === v.durableUrl);
      return {
        ...v,
        signedUrl: entry?.signedUrl,
        signedUrlDisplay: entry ? shortenToken(entry.signedUrl) : undefined,
        expiresAt: entry?.expiresAt ?? undefined,
      };
    });
  }

  get signedPngUrl() {
    return this.rows.find((r) => r.key === 'png')?.signedUrl;
  }

  get signedPdfUrl() {
    return this.rows.find((r) => r.key === 'pdf-print')?.signedUrl;
  }

  // The per-realm session JWT the host already holds for this realm. The
  // auth service worker injects it on GET/HEAD only, so the QUERY mint has
  // to carry it explicitly.
  private sessionTokenFor(realm: string): string | undefined {
    try {
      let raw = globalThis.localStorage?.getItem('boxel-session');
      if (!raw) {
        return undefined;
      }
      return (JSON.parse(raw) as Record<string, string>)[realm];
    } catch {
      return undefined;
    }
  }

  private async mintUrls(urls: string[]): Promise<SignedEntry[]> {
    let realm = this.targetRealm;
    if (!realm) {
      throw new Error('Link a saved card first.');
    }
    let token = this.sessionTokenFor(realm);
    if (!token) {
      throw new Error(
        `No session for ${realm} in localStorage. Open the linked card once so the host mints one, then retry.`,
      );
    }
    let response = await fetch(`${realm}_sign-capture-urls`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-HTTP-Method-Override': 'QUERY',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ urls }),
    });
    let text = await response.text();
    this.rawResponse = text;
    if (!response.ok) {
      throw new Error(`Mint failed: ${response.status} ${text}`);
    }
    return (JSON.parse(text) as { signed: SignedEntry[] }).signed;
  }

  @action
  async mint() {
    this.isRunning = true;
    this.errorMessage = null;
    this.signed = null;
    try {
      this.signed = await this.mintUrls(this.variants.map((v) => v.durableUrl));
    } catch (error) {
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    } finally {
      this.isRunning = false;
    }
  }

  @action
  openUrl(url: string) {
    window.open(url, '_blank', 'noopener');
  }

  // The click-time pattern real download affordances will use: open the tab
  // synchronously (keeping the user activation, so popup blockers allow it),
  // then point it at a freshly minted signed URL.
  @action
  async mintFreshAndOpen(durableUrl: string) {
    let w = window.open('', '_blank');
    try {
      let [entry] = await this.mintUrls([durableUrl]);
      if (w) {
        w.location.href = entry.signedUrl;
      }
    } catch (error) {
      w?.close();
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    }
  }

  <template>
    <article class='signed-capture-tester'>
      <header>
        <h2>Signed Capture URL Tester</h2>
        <p>
          Mints short-lived signed variants of the linked card's capture URLs,
          then exercises the surfaces the auth service worker cannot reach: a
          new-tab navigation and an object-element PDF embed. On a private
          realm, expect the bare URL to fail and the signed one to serve.
        </p>
      </header>

      <section class='field'>
        <label>Card to capture</label>
        <@fields.card />
      </section>

      <section class='actions'>
        <Button
          data-test-mint
          @disabled={{this.isRunning}}
          {{on 'click' this.mint}}
        >
          {{if this.isRunning 'Minting…' 'Mint signed URLs'}}
        </Button>
      </section>

      {{#if this.hasLinkedCard}}
        <section class='rows'>
          {{#each this.rows as |row|}}
            <div class='row' data-test-variant={{row.key}}>
              <h3>{{row.label}}</h3>
              <div class='url-line'>
                <span class='url-tag'>durable</span>
                <code class='url'>{{row.durableUrl}}</code>
                <Button
                  @size='extra-small'
                  @kind='secondary'
                  {{on 'click' (fn this.openUrl row.durableUrl)}}
                >
                  Open bare
                </Button>
              </div>
              {{#if row.signedUrl}}
                <div class='url-line'>
                  <span class='url-tag url-tag--signed'>signed</span>
                  <code class='url'>{{row.signedUrlDisplay}}</code>
                  <Button
                    @size='extra-small'
                    {{on 'click' (fn this.openUrl row.signedUrl)}}
                  >
                    Open signed
                  </Button>
                </div>
                {{#if row.expiresAt}}
                  <p class='expiry'>Expires {{row.expiresAt}}</p>
                {{else}}
                  <p class='expiry'>Echoed unsigned — the realm is publicly
                    readable, so no token is needed.</p>
                {{/if}}
              {{/if}}
              <div class='url-line'>
                <Button
                  @size='extra-small'
                  @kind='muted'
                  {{on 'click' (fn this.mintFreshAndOpen row.durableUrl)}}
                >
                  Mint fresh + open (click-time pattern)
                </Button>
              </div>
            </div>
          {{/each}}
        </section>
      {{else}}
        <p class='hint'>Link a saved card to begin.</p>
      {{/if}}

      {{#if this.signedPngUrl}}
        <section class='embed'>
          <h3>Signed PNG in an img element</h3>
          <p class='hint'>The service worker also covers img loads, so this
            works either way — it proves the token is accepted, not required,
            here.</p>
          <img src={{this.signedPngUrl}} alt='Signed capture' />
        </section>
      {{/if}}

      {{#if this.signedPdfUrl}}
        <section class='embed'>
          <h3>Signed PDF in an object element</h3>
          <p class='hint'>Object loads bypass the service worker entirely, so on
            a private realm this pane renders only because of the token. The
            viewer's own save button is the surface that motivated all of this.</p>
          <object
            data={{this.signedPdfUrl}}
            type='application/pdf'
            aria-label='Signed PDF capture'
          ></object>
        </section>
      {{/if}}

      {{#if this.errorMessage}}
        <p
          class='status status--error'
          data-test-error
        >{{this.errorMessage}}</p>
      {{/if}}

      {{#if this.rawResponse}}
        <details>
          <summary>Raw mint response</summary>
          <pre class='raw'>{{this.rawResponse}}</pre>
        </details>
      {{/if}}
    </article>

    <style scoped>
      .signed-capture-tester {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-lg);
        padding: var(--boxel-sp-lg);
      }
      header p,
      .hint {
        margin: var(--boxel-sp-xs) 0 0;
        color: var(--muted-foreground);
      }
      .field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .field label {
        font-weight: 600;
      }
      .actions {
        display: flex;
        gap: var(--boxel-sp);
      }
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      .row {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border: 1px solid var(--muted);
        border-radius: var(--boxel-border-radius-lg);
      }
      .row h3 {
        margin: 0;
        font-size: var(--boxel-font-size);
      }
      .url-line {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .url-tag {
        flex-shrink: 0;
        padding: 0.125rem 0.375rem;
        border-radius: var(--boxel-border-radius-sm);
        background: var(--muted);
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-xs);
        text-transform: uppercase;
      }
      .url-tag--signed {
        background: var(--primary);
        color: var(--primary-foreground, var(--boxel-dark));
      }
      .url {
        flex: 1;
        word-break: break-all;
        font-size: var(--boxel-font-size-sm);
      }
      .expiry {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .embed {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }
      .embed h3 {
        margin: 0;
      }
      .embed img {
        max-width: 100%;
        border: 1px solid var(--muted);
        border-radius: var(--boxel-border-radius);
      }
      .embed object {
        width: 100%;
        height: 31.25rem;
        border: 1px solid var(--muted);
        border-radius: var(--boxel-border-radius);
      }
      .status {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
      }
      .status--error {
        background: color-mix(in srgb, var(--boxel-error-100) 12%, white);
        color: var(--boxel-error-100);
      }
      .raw {
        overflow-x: auto;
        padding: var(--boxel-sp-sm);
        background: var(--muted);
        border-radius: var(--boxel-border-radius);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>
}

export class SignedCaptureUrlTester extends CardDef {
  static displayName = 'Signed Capture URL Tester';

  @field card = linksTo(CardDef);

  static isolated = Isolated;
}
