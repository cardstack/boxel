import GlimmerComponent from '@glimmer/component';
import CameraIcon from '@cardstack/boxel-icons/camera';

interface ImagePresentationSignature {
  Args: {
    imageUrl?: string;
    hasImage: boolean;
  };
}

export default class ImagePresentation extends GlimmerComponent<ImagePresentationSignature> {
  <template>
    <div class='image-embedded'>
      {{#if @hasImage}}
        <img src={{@imageUrl}} alt='' class='embedded-image' />
      {{else}}
        <div class='no-image'>
          <CameraIcon class='camera-icon' />
          <span>No image</span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .image-embedded {
        width: 100%;
        height: 100%;
      }

      .embedded-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--radius, 0.375rem);
      }

      .no-image {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: calc(var(--spacing, 0.25rem) * 8);
        background: var(--muted, #f1f5f9);
        border-radius: var(--radius, 0.375rem);
        color: var(--muted-foreground, #9ca3af);
        font-size: 0.875rem;
        gap: calc(var(--spacing, 0.25rem) * 2);
      }

      .camera-icon {
        width: 2rem;
        height: 2rem;
      }
    </style>
  </template>
}
