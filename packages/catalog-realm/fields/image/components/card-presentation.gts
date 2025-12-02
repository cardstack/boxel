import GlimmerComponent from '@glimmer/component';
import CameraIcon from '@cardstack/boxel-icons/camera';

interface CardPresentationSignature {
  Args: {
    imageUrl?: string;
    hasImage: boolean;
  };
}

export default class CardPresentation extends GlimmerComponent<CardPresentationSignature> {
  <template>
    <div class='image-card'>
      {{#if @hasImage}}
        <div class='card-image-wrapper'>
          <img src={{@imageUrl}} alt='' class='card-image' />
        </div>
        <div class='card-content'>
          <div class='card-url'>{{@imageUrl}}</div>
        </div>
      {{else}}
        <div class='card-placeholder'>
          <CameraIcon class='card-placeholder-icon' />
          <span class='card-placeholder-text'>No image</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .image-card {
        display: flex;
        flex-direction: column;
        width: 100%;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        overflow: hidden;
        background: var(--background, #ffffff);
        box-shadow: var(--shadow-md, 0 4px 6px -1px rgb(0 0 0 / 0.1));
        transition: all 0.2s ease;
      }

      .image-card:hover {
        box-shadow: var(--shadow-lg, 0 10px 15px -3px rgb(0 0 0 / 0.1));
      }

      .card-image-wrapper {
        width: 100%;
        height: var(--image-card-height, auto);
        background: var(--muted, #f1f5f9);
        flex-shrink: 0;
      }

      .card-image {
        width: 100%;
        height: 100%;
        object-fit: var(--image-card-object-fit, cover);
      }

      .card-content {
        padding: 0.75rem;
        background: var(--background, #ffffff);
      }

      .card-url {
        font-size: 0.8125rem;
        color: var(--foreground, #1a1a1a);
        line-height: 1.4;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        word-break: break-all;
      }

      .card-placeholder {
        width: 100%;
        height: var(--image-card-height, auto);
        aspect-ratio: var(--image-card-aspect-ratio, 4 / 3);
        background: linear-gradient(
          135deg,
          var(--muted, #f1f5f9) 0%,
          color-mix(in srgb, var(--muted-foreground, #9ca3af) 20%, transparent)
            100%
        );
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: calc(var(--spacing, 0.25rem) * 2);
        color: var(--muted-foreground, #9ca3af);
      }

      .card-placeholder-icon {
        width: 2.5rem;
        height: 2.5rem;
      }

      .card-placeholder-text {
        font-size: 0.875rem;
        font-weight: 500;
      }
    </style>
  </template>
}
