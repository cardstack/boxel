import GlimmerComponent from '@glimmer/component';

interface CardSectionArgs {
  Args: {
    title?: string;
    description?: string;
    cards?: Array<{ name: string }>;
  };
  Blocks: {
    intro?: []; // we can choose to use this to pass instead of using args.title if the title block HTML is complex
    content?: []; // we can choose use this to pass instead of using args.content if the content block HTML is complex
  };
  Element: HTMLElement;
}

// Priotize using block intro instead of using args.title / description if both are provided
export default class CardsDisplaySection extends GlimmerComponent<CardSectionArgs> {
  <template>
    {{! TODO: Modify this section once we got the real data or query }}
    {{! TODO: Now we using grid layout for cards }}
    {{! TODO: Remember all card display will be fitted format }}
    <section class='cards-display-section' ...attributes>
      {{#if (has-block 'intro')}}
        {{yield to='intro'}}
      {{else}}
        {{#if @title}}
          <h2>{{@title}}</h2>
        {{/if}}
        {{#if @description}}
          <p>{{@description}}</p>
        {{/if}}
      {{/if}}

      {{#if (has-block 'content')}}
        {{yield to='content'}}
      {{else}}
        {{! Todo: We need to redo this after we got real data, maybe use prerendesearch todsiaply all fitted format card }}
        <ul class='cards'>
          {{#each @cards as |card|}}
            <li class='card'>
              {{card.name}}
            </li>
          {{/each}}
        </ul>
      {{/if}}
    </section>
    <style scoped>
      @layer {
        .cards-display-section {
          --grid-card-min-width: 10.625rem; /* 170px */
          --grid-card-max-width: 10.625rem; /* 170px */
          --grid-card-height: 10.625rem; /* 170px */
        }
        h2,
        p {
          margin-block: 0;
          margin-bottom: var(--boxel-sp);
        }
        .cards {
          display: grid;
          grid-template-columns: repeat(
            auto-fill,
            minmax(var(--grid-card-min-width), var(--grid-card-max-width))
          );
          grid-auto-rows: var(--grid-card-height);
          gap: var(--boxel-sp);
          list-style-type: none;
          padding: 0;
          margin-top: var(--boxel-sp-lg);
        }
        .card {
          height: auto;
          max-width: 100%;
          background-color: var(--boxel-300);
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: var(--boxel-border-radius);
        }
      }
    </style>
  </template>
}
