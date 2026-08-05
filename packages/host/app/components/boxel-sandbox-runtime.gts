import { scheduleOnce } from '@ember/runloop';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { modifier } from 'ember-modifier';

import type { BoxelInstanceHandle } from '@cardstack/runtime-common';

import type { SandboxRenderTarget } from '@cardstack/host/lib/sandbox-render-transport';
import { installSandboxRuntimeHost } from '@cardstack/host/lib/sandbox-runtime-host';
import { connectSandboxSurface } from '@cardstack/host/lib/sandbox-surface-transport';
import type { SandboxSurfaceClient } from '@cardstack/host/lib/sandbox-surface-transport';
import type { BoxelSandboxRuntimeModel } from '@cardstack/host/routes/boxel-sandbox-runtime';
import type DirectBoxelRuntimeService from '@cardstack/host/services/direct-boxel-runtime';

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
  @service declare private directBoxelRuntime: DirectBoxelRuntimeService;

  @tracked private renderedComponent?: ComponentLike<SandboxComponentSignature>;
  @tracked private format = 'isolated';
  @tracked private surface?: SandboxSurfaceClient;
  @tracked private error?: Error;

  private abortBootstrap = new AbortController();

  private runtimeHost = installSandboxRuntimeHost({
    parentOrigin: this.args.model.parentOrigin,
    bootstrapId: this.args.model.bootstrapId,
    createRuntime: () => this.directBoxelRuntime.runtime,
    createRenderTarget: (_runtime, surface) => {
      this.surface = surface;
      return this.renderTarget;
    },
    signal: this.abortBootstrap.signal,
  }).catch((error) => {
    if (!this.abortBootstrap.signal.aborted) {
      this.error = asError(error);
    }
    return undefined;
  });

  private renderTarget: SandboxRenderTarget = {
    render: async (card: BoxelInstanceHandle, format: string) => {
      let slot = this.directBoxelRuntime.runtime.getRenderSlotForHandle(card);
      this.format = format;
      this.renderedComponent =
        slot.component as ComponentLike<SandboxComponentSignature>;
      this.error = undefined;
      await afterRender();
    },
    clear: async () => {
      this.renderedComponent = undefined;
      this.error = undefined;
      await afterRender();
    },
  };

  willDestroy(): void {
    super.willDestroy();
    this.abortBootstrap.abort();
    void this.runtimeHost.then((host) => host?.destroy());
  }

  <template>
    {{#if this.surface}}
      <main
        class='boxel-sandbox-runtime'
        data-boxel-sandbox-runtime
        {{attachSurface this.surface}}
      >
        {{#if this.error}}
          <p role='alert'>{{this.error.message}}</p>
        {{else if this.renderedComponent}}
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
    </style>
  </template>
}

function afterRender(): Promise<void> {
  return new Promise((resolve) => scheduleOnce('afterRender', null, resolve));
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
