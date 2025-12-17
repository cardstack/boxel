import GlimmerComponent from '@glimmer/component';

export interface PolaroidSignature {
  Args: {
    url?: string;
    base64?: string;
    caption?: string;
  };
  Blocks: {
    content: [];
    loading: [];
  };
}

export default class Polaroid extends GlimmerComponent<PolaroidSignature> {
  <template>
    <div class='polaroid'>
      <div class='polaroid-photo'>
        {{#if (has-block 'content')}}
          {{yield to='content'}}
        {{else if @url}}
          <img src={{@url}} alt={{@caption}} class='generated-image' />
        {{else if @base64}}
          <img
            src='data:image/*;base64={{@base64}}'
            alt={{@caption}}
            class='generated-image'
          />
        {{/if}}
        {{#if (has-block 'loading')}}
          {{yield to='loading'}}
        {{/if}}
      </div>
      {{#if @caption}}
        <div class='polaroid-caption'>
          <span class='caption-text'>{{@caption}}</span>
        </div>
      {{/if}}
    </div>
    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500&family=Kalam:wght@400;700&display=swap');

      .polaroid {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1rem;
        padding: 1rem 1rem 2.25rem;
        background: var(--muted, #f7f3eb);
        border-radius: 12px;
        box-shadow:
          0 12px 24px rgba(0, 0, 0, 0.12),
          0 0 0 1px rgba(0, 0, 0, 0.05);
        width: 100%;
      }

      .polaroid::before {
        content: '';
        position: absolute;
        inset: 0.6rem 1rem 0.75rem;
        border-radius: 12px;
        border: 1px dashed rgba(0, 0, 0, 0.05);
        pointer-events: none;
      }

      .polaroid-photo {
        width: 100%;
        aspect-ratio: 1 / 1;
        border-radius: 8px;
        background: var(--card, #ffffff);
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.04);
      }

      .generated-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .polaroid-caption {
        display: flex;
        justify-content: center;
        width: 100%;
      }

      .caption-text {
        font-family: 'Kalam', cursive;
        font-size: 1.05rem;
        color: var(--foreground, #2c2c2c);
        font-weight: 700;
        transform: rotate(-1deg);
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.08);
      }
    </style>
  </template>
}
