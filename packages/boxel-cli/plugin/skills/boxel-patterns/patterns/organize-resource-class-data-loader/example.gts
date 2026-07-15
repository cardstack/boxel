import { Resource } from 'ember-resources';
import { resource } from 'ember-resources';
import { tracked } from '@glimmer/tracking';
import { CardDef } from 'https://cardstack.com/base/card-api';

// 🧩 PATTERN: Resource class with BOXED constructor
//
// Wrapping the class constructor in a plain object `{ ctor, fields }`
// prevents Glimmer from auto-binding `this` when the value is passed
// through {{...}} — which would otherwise break `instanceof` and
// `getFields` introspection on CardDef subclasses.

interface Args {
  positional: [];
  named: {
    codeRef: { module: string; name: string };
  };
}

// Boxed shape: never expose `ctor` directly to templates.
interface ClassBox<T extends typeof CardDef> {
  ctor: T;
  fields: Array<{ name: string; type: string }>;
}

export class GetFieldsResource<
  T extends typeof CardDef = typeof CardDef,
> extends Resource<Args> {
  @tracked result: ClassBox<T> | null = null;
  @tracked isLoading = true;
  @tracked error: Error | null = null;

  modify(_positional: [], named: Args['named']) {
    this.load(named.codeRef);
  }

  private async load(codeRef: Args['named']['codeRef']) {
    try {
      this.isLoading = true;
      let absolute = this.codeRefWithAbsoluteURL(codeRef);
      let cls = await this.getClass(absolute);
      let fields = this.getFields(cls);
      this.result = { ctor: cls as T, fields };
    } catch (err) {
      this.error = err as Error;
    } finally {
      this.isLoading = false;
    }
  }

  // ⚠️ Pseudocode — replace with your real loader.
  private codeRefWithAbsoluteURL(ref: { module: string; name: string }) {
    return {
      // @ts-expect-error import.meta is supported by the Boxel host
      module: new URL(ref.module, import.meta.url).href,
      name: ref.name,
    };
  }
  private async getClass(ref: {
    module: string;
    name: string;
  }): Promise<typeof CardDef> {
    void ref;
    return CardDef;
  }
  private getFields(
    cls: typeof CardDef,
  ): Array<{ name: string; type: string }> {
    void cls;
    return [];
  }
}

// Helper wrapper for template usage.
export function getFieldsResource(codeRef: { module: string; name: string }) {
  return resource(({ use }) =>
    use(GetFieldsResource, () => ({
      named: { codeRef },
    })),
  );
}

// === Template usage ===================================================
//
//   <template>
//     {{#let (getFieldsResource @codeRef) as |r|}}
//       {{#if r.isLoading}}
//         Loading…
//       {{else if r.result}}
//         <p>{{r.result.fields.length}} fields</p>
//         {{!-- ✅ `r.result.ctor` is safe to pass around — boxed --}}
//         {{!-- ❌ never pass r.result.ctor through {{...}} unboxed --}}
//       {{/if}}
//     {{/let}}
//   </template>
