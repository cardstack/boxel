import GlimmerComponent from '@glimmer/component';
import type { BaseDef, CardDef } from '../card-api';
import type BrandGuide from 'https://cardstack.com/base/brand-guide';

export default class DefaultHeadTemplate extends GlimmerComponent<{
  Args: {
    cardOrField: typeof BaseDef;
    model: CardDef;
  };
}> {
  get title() {
    return (
      this.args.model?.cardTitle ?? this.args.cardOrField.displayName ?? 'Card'
    );
  }

  get description(): string | undefined {
    return this.args.model?.cardDescription;
  }

  get image(): string | undefined {
    return this.args.model?.cardThumbnailURL;
  }

  get themeIcon(): string | undefined {
    let theme = this.args.model?.cardInfo?.theme;
    return (
      (theme as BrandGuide | undefined)?.markUsage?.socialMediaProfileIcon ??
      theme?.cardThumbnailURL
    );
  }

  <template>
    {{! template-lint-disable no-forbidden-elements }}
    <title data-test-card-head-title>{{this.title}}</title>

    <meta property='og:title' content={{this.title}} />
    <meta name='twitter:title' content={{this.title}} />
    <meta property='og:url' content={{@model.id}} />

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

    {{#if this.themeIcon}}
      <link rel='icon' href={{this.themeIcon}} />
      <link rel='apple-touch-icon' href={{this.themeIcon}} />
    {{/if}}

    <meta property='og:type' content='website' />
  </template>
}
