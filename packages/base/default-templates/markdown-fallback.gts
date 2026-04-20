import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import type { ComponentLike } from '@glint/template';

import type {
  BaseDef,
  BaseDefComponent,
  CardDef,
  FieldsTypeFor,
  Format,
} from '../card-api';
import { DefaultFormatsProvider } from '../field-component';

// Default `static markdown` template used by `CardDef`, `FieldDef`, and
// `FileDef` when a subclass does not override it (CS-10784).
//
// Strategy:
//   1. Render the HTML fallback format (isolated for cards, embedded for
//      fields) into a hidden "source" container. `DefaultFormatsProvider`
//      overrides the markdown format-recursion so `<@fields.x />` inside
//      the fallback uses HTML formats, not recursive markdown.
//   2. A modifier reads the source container's `innerHTML` after render,
//      invokes the host-provided `globalThis.__boxelHtmlToMarkdown`
//      converter (see `packages/host/app/lib/html-to-markdown.ts`), and
//      stores the result in tracked state.
//   3. The converted markdown is emitted into a `[data-markdown-output]`
//      container, which the prerender pipeline targets for `textContent`
//      extraction.
//
// The converter lives in the host bundle so `packages/base` has zero
// direct dependency on turndown — critical for the "card code must not
// run on the server" constraint, since realm-server never needs to pull
// turndown into its graph.

type HtmlToMarkdownFn = (html: string) => string;

function resolveConverter(): HtmlToMarkdownFn | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }
  let fn = (globalThis as any).__boxelHtmlToMarkdown;
  return typeof fn === 'function' ? fn : undefined;
}

interface FallbackArgs {
  cardOrField: typeof BaseDef;
  model: CardDef;
  fields: FieldsTypeFor<CardDef>;
  format: Format;
}

export default class DefaultMarkdownFallbackTemplate extends Component<{
  Args: FallbackArgs;
}> {
  @tracked markdown = '';

  private get isField(): boolean {
    let cls = this.args.cardOrField as any;
    // `FileDef` is both a field (`isFieldDef`) and a file def. Its embedded
    // template is its isolated template (see card-api.gts), so treating it
    // as a field here picks up the same output either way.
    return Boolean(cls?.isFieldDef);
  }

  private get fallbackFormat(): Format {
    return this.isField ? 'embedded' : 'isolated';
  }

  // We invoke the resolved format component with only the four args the
  // fallback knows about (`model`, `fields`, `format`, `cardOrField`); the
  // strict `BaseDefComponent` signature would also require the full
  // `SignatureFor<...>` shape (`set`, `fieldName`, `createCard`, etc.). Those
  // are normally injected by `getBoxComponent`'s wrapper, not by hand here —
  // so we narrow the return type to a `ComponentLike` that matches the args
  // we actually pass. The runtime resolution still returns the same class.
  private get FallbackComponent(): ComponentLike<{ Args: FallbackArgs }> {
    // FieldDef has no `isolated` slot — only `embedded`/`atom`/`fitted`/`edit`.
    // CardDef and FileDef both define `isolated`. Pick the right slot
    // dynamically so the angle-bracket invocation below works for all three.
    let cls = this.args.cardOrField as unknown as Record<
      string,
      BaseDefComponent
    >;
    return (this.isField ? cls.embedded : cls.isolated) as ComponentLike<{
      Args: FallbackArgs;
    }>;
  }

  private get nestedDefaultFormats() {
    // Provide HTML defaults so `<@fields.x />` inside the fallback renders
    // HTML components instead of recursing back into markdown. The defaults
    // are the same regardless of the outer container — fields render
    // `embedded` and linked cards render `fitted`, mirroring what a typical
    // `isolated`/`embedded` host would request.
    return { fieldDef: 'embedded' as Format, cardDef: 'fitted' as Format };
  }

  private captureAndConvert = modifier((element: HTMLElement) => {
    let convert = () => {
      if (!element.isConnected) {
        return;
      }
      let converter = resolveConverter();
      let html = element.innerHTML;
      let next = converter
        ? converter(html)
        : (element.textContent ?? '').trim();
      if (next !== this.markdown) {
        this.markdown = next;
      }
    };

    // Defer the first conversion to afterRender so Glimmer is not mid-commit
    // when we read the DOM. `scheduleOnce` coalesces repeated schedule calls
    // within the same runloop tick.
    let schedule = () => scheduleOnce('afterRender', this, convert);
    schedule();

    if (typeof MutationObserver === 'undefined') {
      return;
    }

    // Re-convert when the fallback DOM mutates (async data resolves, linked
    // cards load, etc.). The prerender pipeline polls for stability, so the
    // eventual steady-state markdown is what ends up captured.
    let observer = new MutationObserver(schedule);
    observer.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => observer.disconnect();
  });

  <template>
    <div
      class='markdown-fallback-source'
      aria-hidden='true'
      data-markdown-fallback-source
      {{this.captureAndConvert}}
    >
      <DefaultFormatsProvider @value={{this.nestedDefaultFormats}}>
        <this.FallbackComponent
          @model={{@model}}
          @fields={{@fields}}
          @format={{this.fallbackFormat}}
          @cardOrField={{@cardOrField}}
        />
      </DefaultFormatsProvider>
    </div>
    <div data-markdown-output>{{this.markdown}}</div>
    <style scoped>
      .markdown-fallback-source {
        /* Hide the HTML source tree from interactive viewers; the modifier
           still reads its `innerHTML` before conversion. Prerender extracts
           text from `[data-markdown-output]` specifically, so the hidden
           source does not contaminate the captured markdown. */
        display: none;
      }
    </style>
  </template>
}
