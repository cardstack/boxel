import { join, scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';
import { provide } from 'ember-provide-consume-context';

import {
  DefaultFormatsContextName,
  Loader,
  fetcher,
  maybeHandleScopedCSSRequest,
  type BoxelInstanceHandle,
} from '@cardstack/runtime-common';

import DirectBoxelRuntime from '@cardstack/host/lib/direct-boxel-runtime';
import type { SandboxRenderTarget } from '@cardstack/host/lib/sandbox-render-transport';
import { installSandboxRuntimeHost } from '@cardstack/host/lib/sandbox-runtime-host';
import { connectSandboxSurface } from '@cardstack/host/lib/sandbox-surface-transport';
import type { SandboxSurfaceClient } from '@cardstack/host/lib/sandbox-surface-transport';
import type { BoxelSandboxRuntimeModel } from '@cardstack/host/routes/boxel-sandbox-runtime';
import type NetworkService from '@cardstack/host/services/network';

import type { Format } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Args: { model: BoxelSandboxRuntimeModel };
}

interface SandboxComponentSignature {
  Args: { format: string };
  Element: Element;
}

const attachSurface = modifier<{
  Args: { Positional: [SandboxSurfaceClient] };
  Element: HTMLElement;
}>((element, [surface]) =>
  connectSandboxSurface(element, surface, (error) => {
    console.error('Sandbox Surface capability failed', error);
  }),
);

/**
 * Trusted shell inside the isolated origin. Authored Glimmer and its DOM stay
 * below this component; only opaque handles and capability messages cross to
 * the parent Host.
 */
export default class BoxelSandboxRuntime extends Component<Signature> {
  @service declare private network: NetworkService;

  @tracked private renderedComponent?: ComponentLike<SandboxComponentSignature>;
  @tracked private format: Format = 'isolated';
  @tracked private surface?: SandboxSurfaceClient;
  @tracked private error?: Error;

  private abortBootstrap = new AbortController();
  private loader?: Loader;
  private runtime?: DirectBoxelRuntime;
  private moduleFetchHandler?: (request: Request) => Promise<Response>;

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormat is declared but not used"
  private get defaultFormat() {
    return { cardDef: this.format, fieldDef: this.format };
  }

  private runtimeHost = installSandboxRuntimeHost({
    parentOrigin: this.args.model.parentOrigin,
    bootstrapId: this.args.model.bootstrapId,
    createRuntime: (moduleFetch) => {
      this.moduleFetchHandler = (request) => moduleFetch(request);
      this.network.mount(this.moduleFetchHandler);
      let fetch = fetcher(
        this.network.fetch,
        [
          async (request, next) =>
            (await maybeHandleScopedCSSRequest(request)) || next(request),
        ],
        this.network.virtualNetwork,
      );
      this.loader = new Loader(fetch, this.network.resolveImport, {
        virtualNetwork: this.network.virtualNetwork,
      });
      this.runtime = new DirectBoxelRuntime(
        () => this.loader!.import('@cardstack/base/card-api'),
        () => this.loader!,
      );
      return this.runtime;
    },
    createRenderTarget: (_runtime, surface) => {
      join(() => (this.surface = surface));
      return this.renderTarget;
    },
    signal: this.abortBootstrap.signal,
  }).catch((error) => {
    if (!this.abortBootstrap.signal.aborted) {
      join(() => (this.error = asError(error)));
    }
    return undefined;
  });

  private renderTarget: SandboxRenderTarget = {
    render: async (card: BoxelInstanceHandle, format: string) => {
      if (!this.runtime) {
        throw new Error('Sandbox runtime is unavailable');
      }
      let slot = this.runtime.getRenderSlotForHandle(card);
      join(() => {
        this.format = format as Format;
        this.renderedComponent =
          slot.component as ComponentLike<SandboxComponentSignature>;
        this.error = undefined;
      });
      await afterRender();
    },
    clear: async () => {
      join(() => {
        this.renderedComponent = undefined;
        this.error = undefined;
      });
      await afterRender();
    },
  };

  willDestroy(): void {
    super.willDestroy();
    this.abortBootstrap.abort();
    void this.runtimeHost.then((host) => host?.destroy());
    this.loader?.dispose();
    if (this.moduleFetchHandler) {
      this.network.virtualNetwork.unmount(this.moduleFetchHandler);
      this.moduleFetchHandler = undefined;
    }
    this.loader = undefined;
    this.runtime = undefined;
  }

  <template>
    {{#if this.error}}
      <p class='boxel-sandbox-runtime__error' role='alert'>
        {{this.error.message}}
      </p>
    {{else if this.surface}}
      <main
        class='boxel-sandbox-runtime'
        data-boxel-sandbox-runtime
        {{attachSurface this.surface}}
      >
        {{#if this.renderedComponent}}
          <this.renderedComponent @format={{this.format}} />
        {{/if}}
      </main>
    {{/if}}
    <style scoped>
      :global(html),
      :global(body) {
        margin: 0;
        min-height: 100%;
        background: transparent;
      }

      .boxel-sandbox-runtime {
        min-height: 100%;
      }

      .boxel-sandbox-runtime__error {
        margin: 1rem;
        color: #b42318;
        font:
          0.875rem/1.4 system-ui,
          sans-serif;
      }
    </style>
  </template>
}

function afterRender(): Promise<void> {
  return new Promise((resolve) => scheduleOnce('afterRender', null, resolve));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
