import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';

import { fn } from '@ember/helper';
import { on } from '@ember/modifier';

import { realmURL, rri } from '@cardstack/runtime-common';
import {
  SignedCapture,
  SignedCaptureLink,
} from '@cardstack/boxel-host/lib/signed-capture';

import Camera from '@cardstack/boxel-icons/camera';
import Code from '@cardstack/boxel-icons/code';
import FilePdf from '@cardstack/boxel-icons/file-type-pdf';
import Wand from '@cardstack/boxel-icons/wand';
import Link from '@cardstack/boxel-icons/link';
import Gauge from '@cardstack/boxel-icons/gauge';
import Bolt from '@cardstack/boxel-icons/bolt';
import Route from '@cardstack/boxel-icons/route';
import Terminal from '@cardstack/boxel-icons/terminal';

// A presentation-grade walkthrough of the Captures & PDF feature — narrative
// sections that explain each surface, plus a live demo pane that renders a real
// PNG + PDF capture of whatever card you link into `target`. Built to drive a
// sprint-planning walkthrough: link a card, open this in interact mode, and the
// captures below are the actual served artifacts, not mockups.
//
// The four code samples below are plain strings rendered into <pre> blocks, so
// their `{{…}}` and tags are never parsed as part of this component's template.

const DECLARATIVE_SNIPPET = `// Declarative — captured for free at index time, feeds the thumbnail chain
export class ReleaseNote extends CardDef {
  static captures = {
    hero:   { format: 'isolated', width: 800, height: 600, useAsThumbnail: true },
    export: { format: 'isolated', type: 'pdf' },   // a printable PDF slot
  };
}

// then, anywhere the instance is in scope:
//   model.captureURLs.hero    ->  durable PNG URL (undefined until captured)
//   {realm}_capture/{path}?name=hero`;

const IMPERATIVE_SNIPPET = `// Imperative — an AI / command tool; returns a durable served URL
import CaptureCardTool from '@cardstack/boxel-host/tools/capture-card';

let result = await new CaptureCardTool(toolContext).execute({
  card,               // a linksTo(CardDef)
  format: 'isolated', // or 'embedded'
});
let url = result.captures?.[0]?.url;  // stable — a re-capture rotates the bytes`;

const DSL_SNIPPET = `# URL DSL — paste straight into an <img> / <object>, no JavaScript
{realm}_capture/{path}                      # PNG, isolated (default)
{realm}_capture/{path}?format=embedded      # embedded format
{realm}_capture/{path}?viewport=1280x800&dsf=2   # retina, sized
{realm}_capture/{path}?name=hero            # a declared slot (no render work)
{realm}_capture/{path}?type=pdf             # PDF
{realm}_capture/{path}?type=pdf&media=print # PDF under the card's print CSS`;

const CLI_SNIPPET = `# CLI — scriptable captures from a shell or a CI job
boxel capture {card-url}                       # PNG, isolated -> ./<file>.png
boxel capture {card-url} --viewport 1280x800 --dsf 2
boxel capture {card-url} --format fitted --envelope 400x300
boxel capture {card-url} --url-only            # print served URLs, skip bytes

# batch — one request per card, writes capture-manifest.json into --out
boxel capture --spec captures.json --out ./shots
#   spec entries pass captureSpec through verbatim — that is how you
#   ask for { "type": "pdf" }, which has no flag of its own`;

interface Pillar {
  key: string;
  label: string;
  body: string;
}

// The invariants worth a callout in the room.
const PILLARS: Pillar[] = [
  {
    key: 'durable',
    label: 'Durable URLs',
    body: `The served URL never changes — a re-capture rotates the bytes behind it. Safe to store in card data or share externally.`,
  },
  {
    key: 'fresh',
    label: 'Never stale',
    body: `Captures key on the instance's index generation, so an edited card can't serve an old image. Unchanged cards are pure ledger hits — zero Chrome work.`,
  },
  {
    key: 'dedupe',
    label: 'Content-addressed',
    body: `Identical bytes are stored once. A garbage collector reclaims idle on-demand captures on a TTL.`,
  },
  {
    key: 'safe',
    label: 'Cost-guarded',
    body: `A per-realm opt-in gate, a serialized queue with congestion fail-fast, a sync-wait budget, and pixel / page / byte caps (PDF ≤ 20pp / 10MB).`,
  },
  {
    key: 'private',
    label: 'Private realms',
    body: `Signed capture URLs make captures embeddable and downloadable where the auth service worker can't reach — <object> panes and new-tab navigations.`,
  },
  {
    key: 'observed',
    label: 'Fully observed',
    body: `Every capture emits stage-attributed timing to Grafana and to the ledger's diagnostics column, so "why was this slow?" is answerable in SQL.`,
  },
];

class Isolated extends Component<typeof CapturesPdfWalkthrough> {
  get targetCard() {
    return (this.args.model as any)?.target;
  }

  get hasTarget() {
    return Boolean(this.targetCard?.id);
  }

  private get base(): string | undefined {
    let card = this.targetCard;
    let realm: string | undefined = card?.[realmURL]?.href;
    let id: string | undefined = card?.id;
    if (!id || !realm) {
      return undefined;
    }
    return `${realm}_capture/${id.slice(realm.length)}`;
  }

  get pngUrl(): string | undefined {
    return this.base;
  }

  get pdfUrl(): string | undefined {
    let base = this.base;
    return base ? `${base}?type=pdf&media=print` : undefined;
  }

  // The demos this walkthrough points at ship in the same realm, so their
  // instances are addressable from this card's own realm rather than needing
  // a link field apiece — the footer is a table of contents, not data the
  // card owns.
  private get ownRealm(): string | undefined {
    return (this.args.model as any)?.[realmURL]?.href;
  }

  get demos() {
    let realm = this.ownRealm;
    return [
      {
        title: 'Capture Card Demo',
        blurb: 'imperative capture with a format picker',
        module: 'capture-card-demo.gts',
        url: realm
          ? `${realm}CaptureCardDemo/2039c60b-f928-40d5-84bf-94d61fa8bf71`
          : undefined,
      },
      {
        title: 'Signed Capture URL Tester',
        blurb: 'PNG / PDF / print, bare vs signed on a private realm',
        module: 'signed-capture-url-tester.gts',
        url: realm
          ? `${realm}SignedCaptureUrlTester/4e247673-ca96-42e7-a70b-0660c603041e`
          : undefined,
      },
    ];
  }

  // A capture renders this card with no host actions wired up, so the footer
  // has to read as prose there rather than as dead buttons.
  get canNavigate(): boolean {
    return Boolean(this.args.viewCard && this.ownRealm);
  }

  openDemo = (url: string | undefined, event: Event) => {
    if (!url) {
      return;
    }
    event.preventDefault();
    this.args.viewCard?.(rri(url), 'isolated');
  };

  <template>
    <article class='walkthrough'>
      <header class='hero'>
        <p class='eyebrow'>Sprint Walkthrough</p>
        <h1>Captures &amp; PDF</h1>
        <p class='lede'>
          Turn any rendered card — or file — into a
          <strong>persisted, durably-addressable image or PDF</strong>. Produced
          by real headless-Chrome rendering, content-addressed so identical
          captures store once, invalidated automatically when the source
          changes, and served from a URL that stays stable even as the pixels
          behind it rotate.
        </p>
        <ul class='badges'>
          <li>4 entry points</li>
          <li>PNG · PDF</li>
          <li>Auto-invalidated</li>
          <li>Content-addressed</li>
          <li>Private-realm safe</li>
        </ul>
      </header>

      <section class='block'>
        <h2><Camera width='18' height='18' /> The problem it solves</h2>
        <p class='prose'>
          Rendered cards are rich, interactive Ember components — historically
          there was no way to get a static image or a printable document out of
          one. This makes any card exportable as a real-pixel artifact:
          thumbnails, social previews, email and embed images, printable PDFs,
          and inline previews the AI assistant can drop into a room.
        </p>
      </section>

      <section class='block'>
        <h2><Route width='18' height='18' />
          Four ways to ask for a capture</h2>
        <div class='pillars entry'>
          <div class='entry-card'>
            <div class='entry-head'><Code width='16' height='16' /><h3
              >Declarative</h3></div>
            <p>Add a
              <code>static captures</code>
              roster to a card. Captured during indexing — no imperative call —
              and wired into the thumbnail fallback chain.</p>
            <pre class='code'>{{DECLARATIVE_SNIPPET}}</pre>
          </div>
          <div class='entry-card'>
            <div class='entry-head'><Wand width='16' height='16' /><h3
              >Imperative</h3></div>
            <p>Call the capture tool from an AI action or command. It POSTs to
              <code>/_capture-card</code>
              and hands back the durable URL.</p>
            <pre class='code'>{{IMPERATIVE_SNIPPET}}</pre>
          </div>
          <div class='entry-card'>
            <div class='entry-head'><Link width='16' height='16' /><h3>URL DSL</h3></div>
            <p>Compose a URL and drop it into markup. A public realm needs no
              auth; a private one uses the signed-capture affordances.</p>
            <pre class='code'>{{DSL_SNIPPET}}</pre>
          </div>
          <div class='entry-card'>
            <div class='entry-head'><Terminal width='16' height='16' /><h3
              >CLI</h3></div>
            <p>Drive the same
              <code>/_capture-card</code>
              endpoint from a shell. Writes image files plus a per-capture
              manifest, so a CI job can capture a set of cards and diff them.</p>
            <pre class='code'>{{CLI_SNIPPET}}</pre>
          </div>
        </div>
      </section>

      <section class='block demo'>
        <h2><Bolt width='18' height='18' /> Live demo</h2>
        <p class='prose'>
          Link a saved card into
          <strong>Target</strong>
          and the panes below become its real served captures — the exact
          artifacts the DSL URLs above resolve to.
        </p>

        <div class='field'>
          <label>Target card</label>
          <@fields.target />
        </div>

        {{#if this.hasTarget}}
          <div class='demo-grid'>
            <figure class='pane'>
              <figcaption>
                <span class='tag'>PNG</span>
                <code class='url'>{{this.pngUrl}}</code>
              </figcaption>
              <SignedCapture @url={{this.pngUrl}} as |signedUrl error|>
                {{#if signedUrl}}
                  <img
                    src={{signedUrl}}
                    alt='Live PNG capture of the target card'
                  />
                {{else if error}}
                  <p class='status status--error'>{{error}}</p>
                {{else}}
                  <p class='hint'>Rendering capture…</p>
                {{/if}}
              </SignedCapture>
              <SignedCaptureLink @url={{this.pngUrl}}>Open PNG in a new tab</SignedCaptureLink>
            </figure>

            <figure class='pane'>
              <figcaption>
                <span class='tag tag--pdf'>PDF · print media</span>
                <code class='url'>{{this.pdfUrl}}</code>
              </figcaption>
              <SignedCapture @url={{this.pdfUrl}} as |signedUrl error|>
                {{#if signedUrl}}
                  <object
                    class='pdf'
                    data={{signedUrl}}
                    type='application/pdf'
                    aria-label='Live PDF capture of the target card'
                  ></object>
                {{else if error}}
                  <p class='status status--error'>{{error}}</p>
                {{else}}
                  <p class='hint'>Rendering PDF…</p>
                {{/if}}
              </SignedCapture>
              <SignedCaptureLink @url={{this.pdfUrl}}>Open PDF in a new tab</SignedCaptureLink>
            </figure>
          </div>
        {{else}}
          <p class='hint empty'>Link a saved card above to see it captured live.</p>
        {{/if}}
      </section>

      <section class='block'>
        <h2><FilePdf width='18' height='18' />
          PDF is a dimension, not a system</h2>
        <p class='prose'>
          A PDF is the same pipeline with
          <code>type: 'pdf'</code>
          — Chrome's
          <code>page.pdf()</code>
          instead of a raster tile. Two capabilities shipped:
          <strong>declared PDFs</strong>
          (a
          <code>type: 'pdf'</code>
          entry in the
          <code>static captures</code>
          roster, paper taken from the card's own
          <code>@page</code>
          print CSS), and
          <strong>on-demand PDF</strong>
          via
          <code>?type=pdf</code>
          on the DSL or the POST body. PDF specs refuse raster-only geometry
          loudly rather than silently ignoring it, and are capped at 20 pages /
          10&nbsp;MB. Separately, the
          <code>PdfDef</code>
          file family renders PDFs live in a native viewer and paints a real
          first-page poster via vendored pdf.js at capture time.
        </p>
      </section>

      <section class='block'>
        <h2><Gauge width='18' height='18' /> What makes it trustworthy</h2>
        <div class='pillars'>
          {{#each PILLARS as |entry|}}
            <div class='pillar' data-pillar={{entry.key}}>
              <h3>{{entry.label}}</h3>
              <p>{{entry.body}}</p>
            </div>
          {{/each}}
        </div>
      </section>

      <footer class='block outro'>
        <h2>Try the working demos</h2>
        <ul class='links'>
          {{#each this.demos as |demo|}}
            <li>
              {{#if this.canNavigate}}
                <button
                  type='button'
                  class='demo-link'
                  {{on 'click' (fn this.openDemo demo.url)}}
                >{{demo.title}}</button>
              {{else}}
                <strong>{{demo.title}}</strong>
              {{/if}}
              —
              {{demo.blurb}}
              (<code>{{demo.module}}</code>).
            </li>
          {{/each}}
          <li><strong>This card</strong>
            — link a Target above for a live capture of any instance in the
            realm.</li>
        </ul>
      </footer>
    </article>

    <style scoped>
      .walkthrough {
        --accent: #6d5efc;
        --accent-soft: color-mix(in srgb, var(--accent) 12%, transparent);
        container-type: inline-size;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xl);
        max-width: 60rem;
        margin: 0 auto;
        padding: var(--boxel-sp-xl) var(--boxel-sp-lg) var(--boxel-sp-xxl);
        color: var(--foreground);
      }

      /* Hero */
      .hero {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-sm);
        padding: var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-xl, 1rem);
        background:
          radial-gradient(
            120% 140% at 0% 0%,
            var(--accent-soft),
            transparent 60%
          ),
          var(--muted);
        border: 1px solid var(--border, var(--muted));
      }
      .eyebrow {
        margin: 0;
        font-family: var(--font-mono, monospace);
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .hero h1 {
        margin: 0;
        font-size: clamp(2rem, 6cqi, 3.25rem);
        line-height: 1.02;
        font-weight: 600;
        letter-spacing: -0.03em;
      }
      .lede {
        margin: 0;
        max-width: 46rem;
        font-size: clamp(1rem, 2.2cqi, 1.2rem);
        line-height: 1.5;
        color: var(--foreground);
      }
      .badges {
        list-style: none;
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxs);
        margin: var(--boxel-sp-xs) 0 0;
        padding: 0;
      }
      .badges li {
        padding: 0.25rem 0.6rem;
        border-radius: 999px;
        background: var(--background);
        border: 1px solid var(--border, var(--muted));
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        color: var(--muted-foreground);
      }

      /* Section scaffolding */
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }
      h2 {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding-bottom: var(--boxel-sp-xxs);
        border-bottom: 2px solid var(--accent-soft);
        font-size: var(--boxel-font-size-lg, 1.25rem);
        font-weight: 600;
        letter-spacing: -0.01em;
      }
      h2 :deep(svg) {
        color: var(--accent);
        flex-shrink: 0;
      }
      .prose {
        margin: 0;
        max-width: 48rem;
        line-height: 1.6;
        color: var(--foreground);
      }
      code {
        font-family: var(--font-mono, monospace);
        font-size: 0.85em;
        padding: 0.05em 0.35em;
        border-radius: var(--boxel-border-radius-xs, 4px);
        background: var(--accent-soft);
        color: inherit;
      }

      /* Entry-point cards */
      .entry {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      @container (min-width: 46rem) {
        .entry {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      .entry-card {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp);
        border: 1px solid var(--border, var(--muted));
        border-radius: var(--boxel-border-radius-lg);
        background: var(--muted);
      }
      .entry-head {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        color: var(--accent);
      }
      .entry-head h3 {
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        color: var(--foreground);
      }
      .entry-card p {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.5;
        color: var(--muted-foreground);
      }
      pre.code {
        margin: var(--boxel-sp-xxs) 0 0;
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background: #16161f;
        color: #e6e6f0;
        font-family: var(--font-mono, monospace);
        font-size: 0.72rem;
        line-height: 1.55;
        overflow-x: auto;
        white-space: pre;
      }

      /* Live demo */
      .demo .field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        max-width: 32rem;
      }
      .demo .field label {
        font-weight: 600;
        font-size: var(--boxel-font-size-sm);
      }
      .demo-grid {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      @container (min-width: 44rem) {
        .demo-grid {
          grid-template-columns: 1fr 1fr;
        }
      }
      .pane {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        margin: 0;
        padding: var(--boxel-sp);
        border: 1px solid var(--border, var(--muted));
        border-radius: var(--boxel-border-radius-lg);
        background: var(--muted);
      }
      .pane figcaption {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
      }
      .tag {
        align-self: flex-start;
        padding: 0.1rem 0.5rem;
        border-radius: 999px;
        background: var(--accent);
        color: white;
        font-size: var(--boxel-font-size-xs);
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      .tag--pdf {
        background: #c2410c;
      }
      .url {
        word-break: break-all;
        font-size: 0.7rem;
        background: transparent;
        padding: 0;
        color: var(--muted-foreground);
      }
      .pane img {
        width: 100%;
        border: 1px solid var(--border, var(--muted));
        border-radius: var(--boxel-border-radius);
        background: white;
      }
      .pane .pdf {
        width: 100%;
        height: 22rem;
        border: 1px solid var(--border, var(--muted));
        border-radius: var(--boxel-border-radius);
      }

      /* Pillars grid */
      .pillars {
        display: grid;
        grid-template-columns: 1fr;
        gap: var(--boxel-sp);
      }
      @container (min-width: 40rem) {
        .pillars {
          grid-template-columns: 1fr 1fr;
        }
      }
      @container (min-width: 60rem) {
        .pillars:not(.entry) {
          grid-template-columns: repeat(3, 1fr);
        }
      }
      .pillar {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxs);
        padding: var(--boxel-sp);
        border-left: 3px solid var(--accent);
        border-radius: var(--boxel-border-radius);
        background: var(--muted);
      }
      .pillar h3 {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
        margin: 0;
        font-size: var(--boxel-font-size);
        font-weight: 600;
      }
      .pillar h3 :deep(svg) {
        color: var(--accent);
      }
      .pillar p {
        margin: 0;
        font-size: var(--boxel-font-size-sm);
        line-height: 1.5;
        color: var(--muted-foreground);
      }

      /* Outro */
      .outro {
        padding: var(--boxel-sp-lg);
        border-radius: var(--boxel-border-radius-lg);
        background: var(--accent-soft);
        border: 1px solid var(--border, var(--muted));
      }
      .links {
        margin: 0;
        padding-left: 1.1rem;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        line-height: 1.5;
      }

      .demo-link {
        padding: 0;
        border: 0;
        background: none;
        font: inherit;
        font-weight: 600;
        color: var(--accent);
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }

      .demo-link:hover {
        text-decoration-thickness: 2px;
      }

      .demo-link:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
        border-radius: 2px;
      }

      .hint {
        margin: 0;
        color: var(--muted-foreground);
        font-size: var(--boxel-font-size-sm);
      }
      .hint.empty {
        padding: var(--boxel-sp-lg);
        text-align: center;
        border: 1px dashed var(--border, var(--muted));
        border-radius: var(--boxel-border-radius-lg);
      }
      .status--error {
        margin: 0;
        padding: var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius);
        background: color-mix(
          in srgb,
          var(--boxel-error-100, crimson) 12%,
          transparent
        );
        color: var(--boxel-error-100, crimson);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}

export class CapturesPdfWalkthrough extends CardDef {
  static displayName = 'Captures & PDF Walkthrough';
  static icon = Camera;
  static prefersWideFormat = true;

  @field target = linksTo(CardDef);

  static isolated = Isolated;
}
