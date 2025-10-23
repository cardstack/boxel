import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { modifier } from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';
import type {
  BoxComponent,
  CardDef,
} from 'https://cardstack.com/base/card-api';
import type Owner from '@ember/owner';

// Focuses the overlay and wires up keyboard navigation when it renders
const focusAndListen = modifier(
  (element: HTMLElement, [onKeyDown]: [(event: KeyboardEvent) => void]) => {
    element.setAttribute('tabindex', '0');
    element.focus();

    element.addEventListener('keydown', onKeyDown);

    return () => {
      element.removeEventListener('keydown', onKeyDown);
    };
  },
);

export interface LightboxItem {
  component: BoxComponent;
  card: CardDef & { caption?: string };
}

interface LightboxCarouselSignature {
  Args: {
    isOpen: boolean;
    items: LightboxItem[];
    startIndex?: number;
    onClose: () => void;
    onIndexChange?: (index: number) => void;
  };
  Blocks: {
    default: [item: LightboxItem];
  };
}

export class LightboxCarousel extends GlimmerComponent<LightboxCarouselSignature> {
  keyboardNavigation = focusAndListen;

  @tracked private currentIndex = 0;
  private lastStartIndex: number | null = null;

  constructor(owner: Owner, args: LightboxCarouselSignature['Args']) {
    super(owner, args);
    const normalized = this.normalizeIndex(args.startIndex);
    this.currentIndex = normalized;
    this.lastStartIndex = normalized;
  }

  private get items() {
    return this.args.items ?? [];
  }

  private normalizeIndex(index?: number | null) {
    const maxIndex = Math.max(this.items.length - 1, 0);

    if (typeof index !== 'number' || !Number.isFinite(index)) {
      return 0;
    }

    return Math.max(0, Math.min(index, maxIndex));
  }

  private syncIndexFromArgs() {
    const normalized = this.normalizeIndex(this.args.startIndex);

    if (this.lastStartIndex !== normalized) {
      this.currentIndex = normalized;
      this.lastStartIndex = normalized;
    } else if (this.currentIndex > Math.max(this.items.length - 1, 0)) {
      const clamped = this.normalizeIndex(this.currentIndex);
      this.currentIndex = clamped;
      this.lastStartIndex = clamped;
      this.args.onIndexChange?.(clamped);
    }
  }

  get currentItem(): LightboxItem | null {
    this.syncIndexFromArgs();
    return this.items[this.currentIndex] ?? null;
  }

  get hasPrevious() {
    this.syncIndexFromArgs();
    return this.currentIndex > 0;
  }

  get hasNext() {
    this.syncIndexFromArgs();
    return this.currentIndex < this.items.length - 1;
  }

  @action private stopOverlayClick(event: Event) {
    event.stopPropagation();
  }

  @action private close() {
    this.args.onClose?.();
  }

  @action private handleKeyDown(event: KeyboardEvent) {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.close();
        break;
      case 'ArrowRight':
        event.preventDefault();
        this.goToNext();
        break;
      case 'ArrowLeft':
        event.preventDefault();
        this.goToPrevious();
        break;
    }
  }

  @action private goToNext() {
    if (!this.hasNext) return;
    this.transitionToIndex(this.currentIndex + 1, 'next');
  }

  @action private goToPrevious() {
    if (!this.hasPrevious) return;
    this.transitionToIndex(this.currentIndex - 1, 'previous');
  }

  private transitionToIndex(
    targetIndex: number,
    direction: 'next' | 'previous',
  ) {
    const clampedIndex = this.normalizeIndex(targetIndex);
    if (clampedIndex === this.currentIndex) return;

    const lightboxPolaroid =
      typeof document !== 'undefined'
        ? document.querySelector('.lightbox-polaroid')
        : null;
    const slideOutClass =
      direction === 'next' ? 'slide-out-left' : 'slide-out-right';
    const slideInClass =
      direction === 'next' ? 'slide-in-right' : 'slide-in-left';

    const completeTransition = () => {
      this.currentIndex = clampedIndex;
      this.lastStartIndex = clampedIndex;
      this.args.onIndexChange?.(this.currentIndex);
      this.triggerCaptionChange();
      if (lightboxPolaroid) {
        lightboxPolaroid.classList.add(slideInClass);
        setTimeout(() => {
          lightboxPolaroid.classList.remove(slideInClass);
        }, 400);
      }
    };

    if (lightboxPolaroid) {
      lightboxPolaroid.classList.add(slideOutClass);
      setTimeout(() => {
        lightboxPolaroid.classList.remove(slideOutClass);
        completeTransition();
      }, 200);
    } else {
      completeTransition();
    }

    this.triggerNavPulse(direction === 'previous');
  }

  private triggerNavPulse(isLeft: boolean) {
    if (typeof document === 'undefined') return;

    const navSelector = isLeft ? '.lightbox-nav-prev' : '.lightbox-nav-next';
    const navButton = document.querySelector(navSelector);
    if (navButton) {
      navButton.classList.add('pulse');
      setTimeout(() => navButton.classList.remove('pulse'), 300);
    }
  }

  private triggerCaptionChange() {
    // no-op; caption animation removed
  }

  get closeLabel() {
    return this.currentItem?.card?.caption
      ? `Close lightbox for ${this.currentItem.card.caption}`
      : 'Close lightbox';
  }

  <template>
    {{#if @isOpen}}
      <div
        class='lightbox-overlay'
        {{this.keyboardNavigation this.handleKeyDown}}
        {{on 'click' this.close}}
        tabindex='0'
      >
        <div
          class='lightbox-content'
          {{on 'click' this.stopOverlayClick}}
          role='dialog'
          aria-modal='true'
          tabindex='-1'
        >
          <button
            class='lightbox-close'
            {{on 'click' this.close}}
            aria-label={{this.closeLabel}}
          >
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M18 6L6 18M6 6l12 12' />
            </svg>
          </button>

          {{#if this.hasPrevious}}
            <button
              class='lightbox-nav lightbox-nav-prev'
              {{on 'click' this.goToPrevious}}
              aria-label='Previous image'
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M15 18l-6-6 6-6' />
              </svg>
            </button>
          {{/if}}

          {{#if this.hasNext}}
            <button
              class='lightbox-nav lightbox-nav-next'
              {{on 'click' this.goToNext}}
              aria-label='Next image'
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M9 18l6-6-6-6' />
              </svg>
            </button>
          {{/if}}

          <div class='lightbox-polaroid'>
            <div class='lightbox-photo'>
              {{#if this.currentItem}}
                {{yield this.currentItem}}
              {{/if}}
            </div>
          </div>
        </div>
      </div>
    {{/if}}

    <style scoped>
      .lightbox-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.9);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        backdrop-filter: blur(8px);
        animation: fadeIn 0.3s ease;
      }

      @keyframes fadeIn {
        from {
          opacity: 0;
        }
        to {
          opacity: 1;
        }
      }

      .lightbox-content {
        position: relative;
        max-width: 90vw;
        max-height: 90vh;
        animation: scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
        padding: 80px 120px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      @keyframes scaleIn {
        from {
          opacity: 0;
          transform: scale(0.8) rotate(-2deg);
        }
        to {
          opacity: 1;
          transform: scale(1) rotate(0deg);
        }
      }

      .lightbox-polaroid {
        background: transparent;
        padding: 0;
        border: none;
        width: 60vw;
        height: 75vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .lightbox-photo {
        width: 60vw;
        height: 75vh;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .lightbox-photo > :deep(*) {
        width: 60vw;
        height: 75vh;
      }

      .lightbox-close {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 48px;
        height: 48px;
        background: rgba(0, 0, 0, 0.7);
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s ease;
        color: white;
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow-lg, 0 6px 24px rgba(0, 0, 0, 0.3));
        z-index: 10;
      }

      .lightbox-close:hover {
        background: rgba(255, 255, 255, 0.2);
        color: white;
        transform: scale(1.1);
        border-color: rgba(255, 255, 255, 0.4);
      }

      .lightbox-close svg {
        width: 20px;
        height: 20px;
      }

      .lightbox-nav {
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 64px;
        height: 64px;
        border-radius: 50%;
        border: none;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        background: rgba(255, 255, 255, 0.1);
        color: white;
        box-shadow:
          0 10px 30px rgba(0, 0, 0, 0.35),
          inset 0 0 0 1px rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
        transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .lightbox-nav:hover {
        transform: translateY(-50%) scale(1.1);
        background: rgba(255, 255, 255, 0.2);
        box-shadow:
          0 15px 45px rgba(0, 0, 0, 0.4),
          inset 0 0 0 1px rgba(255, 255, 255, 0.3);
      }

      .lightbox-nav-prev {
        left: 30px;
      }

      .lightbox-nav-next {
        right: 30px;
      }

      .lightbox-nav svg {
        width: 24px;
        height: 24px;
        stroke-linecap: round;
        stroke-linejoin: round;
      }

      @media (max-width: 767px) {
        .lightbox-content {
          padding: 60px 40px;
        }

        .lightbox-polaroid {
          width: 85vw;
          height: 65vh;
          padding: 0;
        }

        .lightbox-photo {
          width: 85vw;
          height: 65vh;
        }

        .lightbox-photo > :deep(*) {
          width: 85vw;
          height: 65vh;
        }

        .lightbox-close {
          top: 15px;
          right: 15px;
          width: 40px;
          height: 40px;
        }

        .lightbox-close svg {
          width: 16px;
          height: 16px;
        }

        .lightbox-nav {
          width: 48px;
          height: 48px;
        }

        .lightbox-nav-prev {
          left: 10px;
        }

        .lightbox-nav-next {
          right: 10px;
        }
      }

      @media (max-width: 480px) {
        .lightbox-content {
          padding: 60px 20px;
        }

        .lightbox-close {
          top: 10px;
          right: 10px;
        }

        .lightbox-nav {
          display: none;
        }

        .lightbox-polaroid {
          width: 95vw;
          height: 55vh;
        }

        .lightbox-photo {
          width: 95vw;
          height: 55vh;
        }

        .lightbox-photo > :deep(*) {
          width: 95vw;
          height: 55vh;
        }
      }

      .lightbox-polaroid.slide-out-left {
        animation: slideOutLeft 0.2s ease-in forwards;
      }

      .lightbox-polaroid.slide-out-right {
        animation: slideOutRight 0.2s ease-in forwards;
      }

      .lightbox-polaroid.slide-in-left {
        animation: slideInLeft 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      .lightbox-polaroid.slide-in-right {
        animation: slideInRight 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }

      @keyframes slideOutLeft {
        from {
          transform: translateX(0) scale(1);
          opacity: 1;
        }
        to {
          transform: translateX(-100px) scale(0.9);
          opacity: 0;
        }
      }

      @keyframes slideOutRight {
        from {
          transform: translateX(0) scale(1);
          opacity: 1;
        }
        to {
          transform: translateX(100px) scale(0.9);
          opacity: 0;
        }
      }

      @keyframes slideInLeft {
        from {
          transform: translateX(-100px) scale(0.9);
          opacity: 0;
        }
        to {
          transform: translateX(0) scale(1);
          opacity: 1;
        }
      }

      @keyframes slideInRight {
        from {
          transform: translateX(100px) scale(0.9);
          opacity: 0;
        }
        to {
          transform: translateX(0) scale(1);
          opacity: 1;
        }
      }

      .lightbox-nav:active {
        transform: translateY(-50%) scale(0.95);
        transition: all 0.15s ease;
      }

      .lightbox-nav.pulse {
        animation: navPulse 0.3s ease;
      }

      @keyframes navPulse {
        0% {
          transform: translateY(-50%) scale(1);
        }
        50% {
          transform: translateY(-50%) scale(1.15);
          box-shadow: 0 0 20px rgba(216, 122, 78, 0.4);
        }
        100% {
          transform: translateY(-50%) scale(1);
        }
      }
    </style>
  </template>
}
