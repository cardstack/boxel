import GlimmerComponent from '@glimmer/component';
import type { BaseDef, CardDef } from '../card-api';

export default class DefaultHeadTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
  };
}> {
  get title() {
    return (
      this.args.model?.title ?? this.args.cardOrField.displayName ?? 'Card'
    );
  }

  get description(): string | undefined {
    return this.args.model?.description;
  }

  get image(): string | undefined {
    return this.args.model?.thumbnailURL;
  }

  get url(): string | undefined {
    return this.args.model?.id;
  }

  <template>
    {{! template-lint-disable no-forbidden-elements }}
    <meta property='og:title' content={{this.title}} />
    <meta name='twitter:title' content={{this.title}} />

    {{#if this.description}}
      <meta name='description' content={{this.description}} />
      <meta property='og:description' content={{this.description}} />
      <meta name='twitter:description' content={{this.description}} />
    {{/if}}

    {{#if this.image}}
      <meta property='og:image' content={{this.image}} />
      <meta name='twitter:image' content={{this.image}} />
      <meta name='twitter:card' content='summary_large_image' />
    {{else}}
      <meta name='twitter:card' content='summary' />
    {{/if}}

    {{#if this.url}}
      <link rel='canonical' href={{this.url}} />
      <meta property='og:url' content={{this.url}} />
    {{/if}}

    <meta property='og:type' content='website' />
  </template>
}
