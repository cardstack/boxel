// Card-facing affordances for signed capture URLs, importable as
// `@cardstack/boxel-host/lib/signed-capture`. A durable capture URL
// (`{realm}_screenshot/…`) needs an Authorization header on a private realm,
// which the auth service worker injects only for the loads it can see —
// `<object>`/`<embed>` loads and new-tab navigations bypass it. These two
// components hide the whole signing flow (minting, memoization, popup-blocker
// discipline) so a card template needs no signing JavaScript at all:
//
//   <SignedCaptureLink @url={{this.pdfUrl}}>Download PDF</SignedCaptureLink>
//
//   <SignedCapture @url={{this.pdfUrl}} as |signedUrl|>
//     {{#if signedUrl}}<object data={{signedUrl}} ...></object>{{/if}}
//   </SignedCapture>
//
// Signed URLs are ephemeral view-layer values — render or navigate to them,
// never write them into card data.
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import {
  Button,
  type BoxelButtonKind,
  type BoxelButtonSize,
} from '@cardstack/boxel-ui/components';
import { not } from '@cardstack/boxel-ui/helpers';

import type CaptureUrlSignerService from '../services/capture-url-signer';

// Base cards' render-context signal: set during a server-side prerender,
// absent in a live client render (the same global `pdf-viewer` and
// `query-field-support` read). Prerendered markup must carry only durable
// URLs, so neither component mints during prerender.
function isLiveRender(): boolean {
  return !(globalThis as { __boxelRenderContext?: unknown })
    .__boxelRenderContext;
}

interface SignedCaptureSignature {
  Args: {
    // The durable capture URL to sign. Undefined/null renders the block
    // with no URL.
    url?: string | null;
  };
  Blocks: {
    // [signedUrl, errorMessage] — signedUrl is undefined while minting (and
    // for the whole prerender pass), then the URL to load: the tokened
    // variant, or the durable URL itself on a publicly readable realm.
    default: [string | undefined, string | undefined];
  };
}

interface Loaded {
  forUrl: string;
  signedUrl?: string;
  error?: string;
}

// Renderless provider: yields a loadable form of `@url` once minted. Backed
// by the signer service's memo, so re-renders and sibling components asking
// for the same URL share one mint; a token nearing expiry re-mints on the
// next render that reads it.
export class SignedCapture extends GlimmerComponent<SignedCaptureSignature> {
  @service declare private captureUrlSigner: CaptureUrlSignerService;

  @tracked private loaded: Loaded | undefined;
  private inflightFor: string | undefined;

  private get current(): Loaded | undefined {
    let url = this.args.url;
    if (!url || !isLiveRender()) {
      return undefined;
    }
    if (this.loaded?.forUrl === url) {
      return this.loaded;
    }
    this.requestSign(url);
    return undefined;
  }

  get signedUrl(): string | undefined {
    return this.current?.signedUrl;
  }

  get errorMessage(): string | undefined {
    return this.current?.error;
  }

  private requestSign(url: string) {
    if (this.inflightFor === url) {
      return;
    }
    this.inflightFor = url;
    this.captureUrlSigner
      .getSignedUrl(url)
      .then((signedUrl) => {
        // A stale response for a URL the args have moved past is ignored;
        // the newer request's own resolution wins.
        if (this.args.url === url && !this.isDestroyed && !this.isDestroying) {
          this.loaded = { forUrl: url, signedUrl };
        }
      })
      .catch((e) => {
        if (this.args.url === url && !this.isDestroyed && !this.isDestroying) {
          this.loaded = {
            forUrl: url,
            error: e instanceof Error ? e.message : String(e),
          };
        }
      })
      .finally(() => {
        if (this.inflightFor === url) {
          this.inflightFor = undefined;
        }
      });
  }

  <template>{{yield this.signedUrl this.errorMessage}}</template>
}

interface SignedCaptureLinkSignature {
  Args: {
    // The durable capture URL the link targets.
    url?: string | null;
    // Button styling passthroughs; the default is a link-styled anchor.
    kind?: BoxelButtonKind;
    size?: BoxelButtonSize;
  };
  Blocks: { default: [] };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

// An anchor that opens its capture URL in a new tab with a fresh token,
// rendered through the shared Button so it carries the themed states and
// accessibility markup. The href stays the durable URL (right-click copy
// shares the stable reference; public realms work without interception),
// and the click path follows the popup-blocker discipline: the tab opens
// synchronously under the user activation, then navigates once the mint
// resolves.
export class SignedCaptureLink extends GlimmerComponent<SignedCaptureLinkSignature> {
  @service declare private captureUrlSigner: CaptureUrlSignerService;

  @tracked errorMessage: string | undefined;
  @tracked isPending = false;

  private get kind(): BoxelButtonKind {
    return this.args.kind ?? 'link-primary';
  }

  @action
  private async openSigned(event: Event) {
    let url = this.args.url;
    if (!url) {
      return;
    }
    event.preventDefault();
    this.errorMessage = undefined;
    this.isPending = true;
    let w = window.open('', '_blank');
    try {
      let signedUrl = await this.captureUrlSigner.getSignedUrl(url);
      if (w) {
        w.location.href = signedUrl;
      }
    } catch (e) {
      w?.close();
      this.errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      this.isPending = false;
    }
  }

  <template>
    <Button
      @as='anchor'
      @href={{@url}}
      @kind={{this.kind}}
      @size={{@size}}
      @disabled={{not @url}}
      target='_blank'
      rel='noopener noreferrer'
      aria-busy={{if this.isPending 'true'}}
      data-signed-capture-link
      {{on 'click' this.openSigned}}
      ...attributes
    >{{yield}}</Button>
    {{#if this.errorMessage}}
      <span class='signed-capture-link-error' role='alert'>
        {{this.errorMessage}}
      </span>
    {{/if}}
    <style scoped>
      .signed-capture-link-error {
        color: var(--destructive-ink);
        font-size: var(--boxel-font-size-sm);
      }
    </style>
  </template>
}
