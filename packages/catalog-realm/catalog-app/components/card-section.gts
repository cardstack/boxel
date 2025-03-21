import GlimmerComponent from '@glimmer/component';

interface CardSectionArgs {
  Args: {
    title: string;
    cards: Array<{ name: string }>;
  };
  Element: HTMLElement;
}

export default class CardSection extends GlimmerComponent<CardSectionArgs> {
  <template>
    {{! TODO: Modify this section once we got the real data or query }}
    {{! TODO: Now we using grid layout for cards }}
    {{! TODO: Remember all card display will be fitted format }}
    <section class='card-section' ...attributes>
      <h2>{{@title}}</h2>
      <ul class='cards'>
        {{#each @cards as |card|}}
          <li class='card'>
            {{card.name}}
          </li>
        {{/each}}
      </ul>
    </section>
    <style scoped>
      @layer {
        .card-section {
          --grid-card-min-width: 10.625rem; /* 170px */
          --grid-card-max-width: 10.625rem; /* 170px */
          --grid-card-height: 10.625rem; /* 170px */
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
