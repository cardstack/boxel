import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { provide } from 'ember-provide-consume-context';
import { resource, use } from 'ember-resources';
import { TrackedObject } from 'tracked-built-ins';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  DefaultFormatsContextName,
  type RealmResourceIdentifier,
  type SurfaceHandle,
} from '@cardstack/runtime-common';

import HeadFormatPreview from '@cardstack/host/components/head-format-preview';
import type {
  BoxelExecutionRenderSlot,
  BoxelExecutionSessionSnapshot,
} from '@cardstack/host/lib/boxel-execution-engine';
import type {
  CapsuleComponent,
  CapsuleRenderSlot,
} from '@cardstack/host/lib/capsule-component';
import type { DirectRenderSlot } from '@cardstack/host/lib/direct-boxel-runtime';
import type { HTMLComponent } from '@cardstack/host/lib/html-component';
import type { SandboxRenderSlot } from '@cardstack/host/lib/sandbox-runtime-process';
import boxelSandboxSlot from '@cardstack/host/modifiers/boxel-sandbox-slot';
import surfaceElement from '@cardstack/host/modifiers/surface-element';

import type BoxelExecutionService from '@cardstack/host/services/boxel-execution';

import type {
  BaseDef,
  BoxComponent,
  FieldFormats,
  Format,
  ViewCardFn,
} from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

interface Signature {
  Element: HTMLElement;
  Args: {
    card: BaseDef;
    format?: Format;
    displayContainer?: boolean;
    viewCard?: ViewCardFn;
    relativeTo?: RealmResourceIdentifier;
  };
}

type ExecutionRendererState = {
  [key: string]: unknown;
  snapshot: BoxelExecutionSessionSnapshot;
  slot?: BoxelExecutionRenderSlot;
  model?: Record<string, unknown>;
  fields?: Record<string, BoxComponent>;
  placeholder?: HTMLComponent;
  surface?: SurfaceHandle;
};

type HeadComponent = ComponentLike<{
  Args: {
    displayContainer?: boolean;
    model?: Record<string, unknown>;
  };
}>;

export default class BoxelExecutionRenderer extends Component<Signature> {
  @service declare private boxelExecution: BoxelExecutionService;

  private readonly surfaceId: string;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.surfaceId = this.boxelExecution.surfaceId();
  }

  @provide(DefaultFormatsContextName)
  // @ts-ignore "defaultFormats is declared but consumed through context"
  private get defaultFormats(): FieldFormats {
    let format = this.args.format ?? 'isolated';
    if (format === 'edit') {
      return { cardDef: 'edit', fieldDef: 'edit' };
    }
    if (format === 'atom' || format === 'head' || format === 'markdown') {
      return { cardDef: format, fieldDef: format };
    }
    return { cardDef: format, fieldDef: 'embedded' };
  }

  @use private execution = resource(({ on }) => {
    let session = this.boxelExecution.createSession();
    let state = new TrackedObject<ExecutionRendererState>({
      snapshot: session.snapshot,
    });
    let unsubscribe = session.subscribe((snapshot) => {
      state.snapshot = snapshot;
    });
    let card = this.args.card;
    let format = this.args.format;
    let active = true;
    void this.boxelExecution
      .prerenderedComponentFor(card, format)
      .then((placeholder) => {
        if (active && placeholder) {
          state.placeholder = placeholder;
        }
      });
    void (async () => {
      try {
        let request = await this.boxelExecution.requestFor(
          card,
          format,
          this.surfaceId,
          this.args.relativeTo,
        );
        let generation = await session.update(request);
        if (!generation) {
          return;
        }
        state.model = Object.fromEntries(
          generation.renderRecord.instance.fields.map((field) => [
            field.fieldName,
            field.value,
          ]),
        );
        if (generation.renderRecord.instance.id) {
          state.model.id = generation.renderRecord.instance.id;
        }
        state.fields = await this.boxelExecution.fieldPortalsFor(card);
        state.slot = await session.getRenderSlot(format ?? 'isolated');
        if (state.slot.owner !== 'sandbox') {
          state.surface = this.boxelExecution.registerSurface(
            state.slot.owner,
            this.surfaceId,
          );
        }
      } catch (error) {
        state.snapshot = {
          ...session.snapshot,
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    })();
    on.cleanup(() => {
      active = false;
      unsubscribe();
      if (state.surface) {
        this.boxelExecution.releaseSurface(state.surface);
      }
      void session.destroy();
    });
    return state;
  });

  private get state() {
    return this.execution;
  }

  private get capsuleSlot(): CapsuleRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'capsule' ? slot : undefined;
  }

  private get directSlot(): DirectRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'direct' ? slot : undefined;
  }

  private get sandboxSlot(): SandboxRenderSlot | undefined {
    let slot = this.state.slot;
    return slot?.owner === 'sandbox' ? slot : undefined;
  }

  private get renderedComponent() {
    return this.capsuleSlot?.component ?? this.directSlot?.component;
  }

  private get headComponent(): HeadComponent | undefined {
    if (this.args.format !== 'head') {
      return undefined;
    }
    return this.renderedComponent as HeadComponent | undefined;
  }

  private get hasCapsuleRendering(): boolean {
    return Boolean(this.capsuleSlot && this.state.surface);
  }

  private get hasDirectRendering(): boolean {
    return Boolean(this.directSlot && this.state.surface);
  }

  private get capsuleComponent(): CapsuleComponent {
    let component = this.capsuleSlot?.component;
    if (!component) {
      throw new Error('Capsule component is not ready');
    }
    return component;
  }

  private get capsuleSurface(): SurfaceHandle {
    let surface = this.state.surface;
    if (!surface) {
      throw new Error('Capsule Surface is not ready');
    }
    return surface;
  }

  private get directComponent(): DirectRenderSlot['component'] {
    let component = this.directSlot?.component;
    if (!component) {
      throw new Error('Direct component is not ready');
    }
    return component;
  }

  private get directSurface(): SurfaceHandle {
    let surface = this.state.surface;
    if (!surface) {
      throw new Error('Direct Surface is not ready');
    }
    return surface;
  }

  private get cardURL(): string | undefined {
    return 'id' in this.args.card
      ? (this.args.card.id as string | undefined)
      : undefined;
  }

  private get errorMessage(): string {
    return this.state.snapshot.error?.message ?? 'Unknown execution error';
  }

  private get errorStack(): string | undefined {
    return this.state.snapshot.error?.stack;
  }

  <template>
    {{#if this.headComponent}}
      <HeadFormatPreview
        @renderedCard={{this.headComponent}}
        @model={{this.state.model}}
        @fields={{this.state.fields}}
        @cardURL={{this.cardURL}}
      />
    {{else if this.hasCapsuleRendering}}
      <div
        class='boxel-execution-capsule-slot'
        data-boxel-execution='capsule'
        {{surfaceElement this.capsuleSurface}}
        ...attributes
      >
        <this.capsuleComponent
          @model={{this.state.model}}
          @fields={{this.state.fields}}
          @format={{@format}}
          @renderRecord={{this.state.snapshot.current.renderRecord}}
          @displayContainer={{@displayContainer}}
          @viewCard={{@viewCard}}
        />
      </div>
    {{else if this.sandboxSlot}}
      <div
        class='boxel-execution-sandbox-slot'
        data-boxel-execution='sandbox'
        {{boxelSandboxSlot this.sandboxSlot}}
        ...attributes
      ></div>
    {{else if this.hasDirectRendering}}
      <div
        class='boxel-execution-direct-slot'
        data-boxel-execution='direct'
        {{surfaceElement this.directSurface}}
        ...attributes
      >
        <this.directComponent @displayContainer={{@displayContainer}} />
      </div>
    {{else if (eq this.state.snapshot.status 'error')}}
      <section class='boxel-execution-error' role='alert' ...attributes>
        <strong>Unable to render this card</strong>
        <p>{{this.errorMessage}}</p>
        {{#if this.errorStack}}
          <details>
            <summary>Details</summary>
            <pre>{{this.errorStack}}</pre>
          </details>
        {{/if}}
      </section>
    {{else if this.state.placeholder}}
      <div
        class='boxel-execution-placeholder'
        aria-label='Loading interactive card'
        aria-busy='true'
        data-boxel-execution='prerender'
        ...attributes
      >
        <this.state.placeholder />
      </div>
    {{else}}
      <div
        class='boxel-execution-loading'
        aria-label='Loading card'
        ...attributes
      ></div>
    {{/if}}

    <style scoped>
      .boxel-execution-sandbox-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-execution-capsule-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-execution-direct-slot {
        min-width: 0;
        width: 100%;
      }

      .boxel-execution-sandbox-slot > :global(iframe) {
        border: 0;
        display: block;
        min-height: inherit;
        width: 100%;
      }

      .boxel-execution-loading {
        min-height: 3rem;
      }

      .boxel-execution-placeholder {
        min-width: 0;
        pointer-events: none;
        width: 100%;
      }

      .boxel-execution-error {
        background: var(--boxel-light-100);
        color: var(--boxel-dark);
        padding: 1rem;
      }

      .boxel-execution-error p {
        margin: 0.5rem 0 0;
      }

      .boxel-execution-error pre {
        overflow: auto;
        white-space: pre-wrap;
      }
    </style>
  </template>
}
