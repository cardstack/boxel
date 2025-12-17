import Component from '@glimmer/component';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { PolaroidImage } from './polaroid-image';
import Polaroid from '../components/polaroid';

function normalizePeriod(value?: string) {
  return value?.trim().toLowerCase() ?? '';
}

export interface PolaroidScatterSignature {
  Args: {
    images?: PolaroidImage[];
    loadingPeriods?: string[];
    onSelect?: (image: PolaroidImage) => void;
  };
}

export class PolaroidScatter extends Component<PolaroidScatterSignature> {
  get images() {
    return this.args.images ?? [];
  }

  hasImage(image?: PolaroidImage) {
    return Boolean(image?.image?.url);
  }

  imageUrlFor(image: PolaroidImage) {
    return image.image?.url ?? '';
  }

  get loadingSet() {
    return new Set(
      (this.args.loadingPeriods ?? []).map((period) => normalizePeriod(period)),
    );
  }

  handleClick = (image: PolaroidImage, event: Event) => {
    event.preventDefault();
    this.args.onSelect?.(image);
  };

  isLoading = (image?: PolaroidImage) => {
    if (!image) {
      return false;
    }
    return this.loadingSet.has(normalizePeriod(image.caption));
  };

  <template>
    <div class='polaroids-container'>
      {{#if this.images.length}}
        {{#each this.images as |image|}}
          <article
            class='polaroid
              {{if (this.hasImage image) "polaroid-clickable"}}
              {{if (this.isLoading image) "is-loading"}}'
            {{on 'click' (fn this.handleClick image)}}
            tabindex='0'
          >
            <Polaroid
              @url={{this.imageUrlFor image}}
              @caption={{image.caption}}
            >
              <:loading>
                {{#if (this.isLoading image)}}
                  <div class='loading-overlay'>
                    <div class='loading-spinner'></div>
                    <span class='loading-text'>Generating…</span>
                  </div>
                {{/if}}
              </:loading>
            </Polaroid>
          </article>
        {{/each}}
      {{else}}
        <div class='placeholder empty-state'>
          <p>No images generated yet. Upload an image and click "Generate
            Through the Ages" to begin.</p>
        </div>
      {{/if}}
    </div>
    <style scoped>
      .polaroids-container {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 2rem;
        padding: 1rem;
      }

      .polaroid {
        position: relative;
        background: var(--background, #fffcf5);
        border-radius: 12px;
        box-shadow:
          0 12px 24px rgba(0, 0, 0, 0.12),
          0 0 0 1px rgba(0, 0, 0, 0.05);
        display: flex;
        flex-direction: column;
        gap: 1rem;
        transform: rotate(calc(var(--rotation, 0deg)));
        transition: transform 0.3s ease;
        cursor: default;
      }

      .polaroid:nth-child(even) {
        --rotation: 0.75deg;
      }

      .polaroid:nth-child(odd) {
        --rotation: -0.85deg;
      }

      .polaroid:nth-child(3n) {
        --rotation: 0.35deg;
      }

      .polaroid-clickable {
        cursor: pointer;
      }

      .polaroid-clickable:hover {
        transform: translateY(-6px) rotate(calc(var(--rotation, 0deg)));
      }

      .polaroid.is-loading {
        cursor: progress;
      }

      .polaroid::before {
        content: '';
        position: absolute;
        inset: 0.5rem 0.75rem;
        border-radius: 12px;
        border: 1px dashed rgba(0, 0, 0, 0.04);
        pointer-events: none;
      }

      .loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: rgba(0, 0, 0, 0.45);
        color: #ffffff;
        gap: 0.5rem;
        font-family: 'Inter', sans-serif;
        font-size: 0.9rem;
        letter-spacing: 0.02em;
      }

      .loading-spinner {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.35);
        border-top-color: #ffffff;
        animation: spin 1s linear infinite;
      }

      .empty-state {
        grid-column: 1 / -1;
        background: rgba(255, 255, 255, 0.8);
        border-radius: 16px;
        padding: 2rem;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.1);
      }

      @keyframes spin {
        to {
          transform: rotate(360deg);
        }
      }
    </style>
  </template>
}
