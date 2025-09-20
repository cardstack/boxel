import { tracked } from '@glimmer/tracking';
import { Resource } from 'ember-modify-based-class-resource';
import {
  type CodeRef,
  getClass,
  codeRefWithAbsoluteURL,
  isResolvedCodeRef,
  isBaseDef,
} from '@cardstack/runtime-common';
import {
  BaseDef,
  type Field,
  getFields,
} from 'https://cardstack.com/base/card-api';

interface GetFieldsResourceArgs {
  named: {
    cardTypeRef?: CodeRef;
    realm?: string;
    getFieldsOpts?: {
      usedLinksToFieldsOnly?: boolean;
      includeComputeds?: boolean;
    };
  };
}

class GetFieldsResource extends Resource<GetFieldsResourceArgs> {
  // Why boxed?
  // Passing a function value (like a class constructor) through a Glimmer template/resource boundary
  // causes Ember/Glimmer to auto-bind it to the component/resource instance. That turns the constructor
  // into a bound function, changing its identity and breaking prototype checks and field discovery
  // (e.g., instanceof checks, getFields on classes, etc.).
  // By wrapping the ctor and its precomputed fields inside a plain object, we avoid passing the function
  // itself as a top-level value through templates, preventing auto-binding and keeping the constructor unbound.
  @tracked boxed: {
    ctor: typeof BaseDef;
    fields: { [fieldName: string]: Field };
  } | null = null;
  @tracked isLoading = false;
  @tracked error: Error | null = null;

  modify(_positional: never[], named: GetFieldsResourceArgs['named']) {
    const { cardTypeRef, realm, getFieldsOpts } = named;
    if (!cardTypeRef || !realm) {
      this.boxed = null;
      this.isLoading = false;
      this.error = null;
      return;
    }

    this.load(cardTypeRef, realm, getFieldsOpts);
  }

  private async load(
    cardTypeRef: CodeRef,
    realm?: string,
    getFieldsOpts?: {
      usedLinksToFieldsOnly?: boolean;
      includeComputeds?: boolean;
    },
  ) {
    this.isLoading = true;
    this.error = null;

    try {
      const loader = (import.meta as any).loader;
      const relativeTo = realm ? new URL(realm) : undefined;
      // Prefer getClass for unbound constructor when ref is simple
      const resolved = codeRefWithAbsoluteURL(cardTypeRef, relativeTo);
      if (isResolvedCodeRef(resolved)) {
        const exported = await getClass(resolved, loader);
        if (!isBaseDef(exported)) {
          throw new Error(
            `Export ${resolved.name} from ${resolved.module} is not a BaseDef`,
          );
        }
        // Unbound class constructor
        const ctor = exported as typeof BaseDef;
        // Precompute fields with provided options and expose boxed form to avoid binding issues in templates
        const fields = getFields(
          ctor,
          getFieldsOpts ?? { includeComputeds: true },
        );
        this.boxed = { ctor, fields };
      } else {
        // No fallback: composed refs like ancestorOf/fieldOf are not supported here
        throw new Error(
          `get-fields-resource only supports simple code refs (module+export). Received a composed ref: ${JSON.stringify(
            cardTypeRef,
          )}`,
        );
      }

      if (!this.boxed) {
        // Defensive: ensure boxed is set; otherwise throw
        throw new Error('Failed to load fields: boxed result is null');
      }
    } catch (error) {
      console.error('Failed to load fields:', error);
      this.error = error as Error;
      this.boxed = null;
    } finally {
      this.isLoading = false;
    }
  }
}

export function getFieldsResource(
  parent: object,
  cardTypeRef: () => CodeRef | undefined,
  realm?: () => string | undefined,
  getFieldsOpts?: () =>
    | { usedLinksToFieldsOnly?: boolean; includeComputeds?: boolean }
    | undefined,
) {
  return GetFieldsResource.from(parent, () => ({
    named: {
      cardTypeRef: cardTypeRef(),
      realm: realm?.(),
      getFieldsOpts: getFieldsOpts?.(),
    },
  }));
}
