import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';
import GlimmerComponent from '@glimmer/component';

import { realmURL } from '@cardstack/runtime-common';
import {
  SignedCapture,
  SignedCaptureLink,
} from '@cardstack/boxel-host/lib/signed-capture';

// Interactive harness for the signed-capture-URL flow. Links a target card,
// composes its durable capture URLs, and exercises the browser surfaces the
// auth service worker cannot reach — new-tab navigations and an <object> PDF
// embed — through the host's signed-capture affordances. On a private realm
// the bare URL draws a 401 while the signed variants serve; on a public
// realm both work. All minting, memoization, and popup-blocker handling
// lives in `@cardstack/boxel-host/lib/signed-capture`; this card holds no
// signing JavaScript.

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

// One capture variant's row: the durable URL, a bare anchor (the broken case
// on a private realm), and the signing affordances.
class VariantRow extends GlimmerComponent<{
  Args: { label: string; durableUrl: string };
}> {
  <template>
    <div class='row' data-test-variant>
      <h3>{{@label}}</h3>
      <div class='url-line'>
        <code class='url'>{{@durableUrl}}</code>
      </div>
      <div class='url-line'>
        <a href={{@durableUrl}} target='_blank' rel='noopener noreferrer'>Open
          bare</a>
        <SignedCaptureLink @url={{@durableUrl}}>
          Open signed (mints on click)
        </SignedCaptureLink>
      </div>
    </div>
    <style scoped>
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
        gap: var(--boxel-sp);
      }
      .url {
        word-break: break-all;
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

class Isolated extends Component<typeof SignedCaptureUrlTester> {
  get targetCard() {
    return (this.args.model as any)?.card;
  }

  get hasLinkedCard() {
    return Boolean(this.targetCard?.id);
  }

  get variants(): (Variant & { durableUrl: string })[] {
    let card = this.targetCard;
    let realm: string | undefined = card?.[realmURL]?.href;
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

  get pngUrl() {
    return this.variants.find((v) => v.key === 'png')?.durableUrl;
  }

  get pdfPrintUrl() {
    return this.variants.find((v) => v.key === 'pdf-print')?.durableUrl;
  }

  <template>
    <article class='signed-capture-tester'>
      <header>
        <h2>Signed Capture URL Tester</h2>
        <p>
          Exercises signed capture URLs on the surfaces the auth service worker
          cannot reach: new-tab navigations and an object-element PDF embed. On
          a private realm, expect "Open bare" to fail and the signed affordances
          to serve.
        </p>
      </header>

      <section class='field'>
        <label>Card to capture</label>
        <@fields.card />
      </section>

      {{#if this.hasLinkedCard}}
        <section class='rows'>
          {{#each this.variants as |v|}}
            <VariantRow @label={{v.label}} @durableUrl={{v.durableUrl}} />
          {{/each}}
        </section>

        <section class='embed'>
          <h3>Signed PNG in an img element</h3>
          <p class='hint'>The service worker also covers img loads, so this
            works either way — it proves the token is accepted, not required,
            here.</p>
          <SignedCapture @url={{this.pngUrl}} as |signedUrl error|>
            {{#if signedUrl}}
              <img src={{signedUrl}} alt='Signed capture' />
            {{else if error}}
              <p class='status status--error'>{{error}}</p>
            {{else}}
              <p class='hint'>Minting…</p>
            {{/if}}
          </SignedCapture>
        </section>

        <section class='embed'>
          <h3>Signed PDF in an object element</h3>
          <p class='hint'>Object loads bypass the service worker entirely, so on
            a private realm this pane renders only because of the token. The
            viewer's own save button is the surface that motivated all of this.</p>
          <SignedCapture @url={{this.pdfPrintUrl}} as |signedUrl error|>
            {{#if signedUrl}}
              <object
                data={{signedUrl}}
                type='application/pdf'
                aria-label='Signed PDF capture'
              ></object>
            {{else if error}}
              <p class='status status--error'>{{error}}</p>
            {{else}}
              <p class='hint'>Minting…</p>
            {{/if}}
          </SignedCapture>
        </section>
      {{else}}
        <p class='hint'>Link a saved card to begin.</p>
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
      .rows {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
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
    </style>
  </template>
}

export class SignedCaptureUrlTester extends CardDef {
  static displayName = 'Signed Capture URL Tester';

  @field card = linksTo(CardDef);

  static isolated = Isolated;
}
