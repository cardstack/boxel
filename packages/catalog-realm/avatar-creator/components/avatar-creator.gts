import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { task } from 'ember-concurrency';
import { BoxelButton, BoxelInput } from '@cardstack/boxel-ui/components';

import {
  AvataaarsModel,
  DEFAULT_AVATAR_VALUES,
  getAvataarsUrl,
  generateRandomAvatarModel,
  getCategoryOptions,
  getOptionPreviewUrl,
  getCurrentSelectionForCategory,
  updateAvatarModelForCategory,
  playClickSound,
} from '../../utils/external/avataar';

import { SuggestAvatar } from '../../commands/suggest-avatar';

interface AvatarCreatorArgs {
  model: AvataaarsModel;
  context?: any;
  onUpdate?: (model: AvataaarsModel) => void;
  isImageGenerating?: boolean;
  generatedImage?: string;
  errorImageGenerating?: string;
  onCreateRealImage?: () => void;
}

export default class AvatarCreatorComponent extends Component<AvatarCreatorArgs> {
  @tracked selectedCategory = 'hair';
  @tracked copySuccess = false;

  // Internal mutable avatar state using TrackedMap
  @tracked currentModel = new TrackedMap([
    ['topType', this.args.model?.topType || DEFAULT_AVATAR_VALUES.topType],
    [
      'accessoriesType',
      this.args.model?.accessoriesType || DEFAULT_AVATAR_VALUES.accessoriesType,
    ],
    [
      'hairColor',
      this.args.model?.hairColor || DEFAULT_AVATAR_VALUES.hairColor,
    ],
    [
      'facialHairType',
      this.args.model?.facialHairType || DEFAULT_AVATAR_VALUES.facialHairType,
    ],
    [
      'clotheType',
      this.args.model?.clotheType || DEFAULT_AVATAR_VALUES.clotheType,
    ],
    ['eyeType', this.args.model?.eyeType || DEFAULT_AVATAR_VALUES.eyeType],
    [
      'eyebrowType',
      this.args.model?.eyebrowType || DEFAULT_AVATAR_VALUES.eyebrowType,
    ],
    [
      'mouthType',
      this.args.model?.mouthType || DEFAULT_AVATAR_VALUES.mouthType,
    ],
    [
      'skinColor',
      this.args.model?.skinColor || DEFAULT_AVATAR_VALUES.skinColor,
    ],
  ]);

  // Get Avataaars URL for the image
  get avataaarsUrl() {
    // Convert TrackedMap to object for getAvataarsUrl function
    const modelObj = Object.fromEntries(this.currentModel.entries());
    return getAvataarsUrl(modelObj as AvataaarsModel);
  }

  get currentCategoryOptions() {
    return getCategoryOptions(this.selectedCategory);
  }

  selectCategory = (category: string) => {
    this.selectedCategory = category;
  };

  generateRandomAvatar = () => {
    // Play click sound
    playClickSound();

    // Generate random avatar using the utility function
    const randomAvatar = generateRandomAvatarModel();

    // Apply random selections to internal state - reassign entire TrackedMap
    this.currentModel = new TrackedMap(Object.entries(randomAvatar));

    // Notify parent component of the change
    this.args.onUpdate?.(randomAvatar);
  };

  selectAvataaarsOption = (option: { value: string; label: string }) => {
    // Get current model as object
    const currentModelObj = Object.fromEntries(
      this.currentModel.entries(),
    ) as AvataaarsModel;

    // Update using the utility function
    const updatedModel = updateAvatarModelForCategory(
      currentModelObj,
      this.selectedCategory,
      option.value,
    );

    // Update internal state
    this.currentModel = new TrackedMap(Object.entries(updatedModel));

    // Notify parent component of the change
    this.args.onUpdate?.(updatedModel);
  };

  copyAvataaarsUrl = () => {
    try {
      // Play click sound
      playClickSound();
      navigator.clipboard.writeText(this.avataaarsUrl);
      this.copySuccess = true;
      // Reset success state after 2 seconds
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  // Generate preview URL for each option
  getOptionPreviewUrl = (option: { value: string; label: string }) => {
    const currentModelObj = Object.fromEntries(
      this.currentModel.entries(),
    ) as AvataaarsModel;
    return getOptionPreviewUrl(
      currentModelObj,
      this.selectedCategory,
      option.value,
    );
  };

  // Getters for template use - these properly track TrackedMap changes
  get topType() {
    return this.currentModel.get('topType');
  }

  get hairColor() {
    return this.currentModel.get('hairColor');
  }

  get mouthType() {
    return this.currentModel.get('mouthType');
  }

  get skinColor() {
    return this.currentModel.get('skinColor');
  }

  get eyeType() {
    return this.currentModel.get('eyeType');
  }

  get eyebrowType() {
    return this.currentModel.get('eyebrowType');
  }

  get clotheType() {
    return this.currentModel.get('clotheType');
  }

  get currentSelection() {
    try {
      const currentModelObj = Object.fromEntries(
        this.currentModel.entries(),
      ) as AvataaarsModel;
      return getCurrentSelectionForCategory(
        currentModelObj,
        this.selectedCategory,
      );
    } catch (error) {
      console.warn('Error getting current selection:', error);
      return null;
    }
  }

  _suggestAvatar = task(async () => {
    try {
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        throw new Error(
          'Command context does not exist. Please switch to Interact Mode',
        );
      }

      let suggestCommand = new SuggestAvatar(commandContext);
      await suggestCommand.execute({
        name: 'Avatar',
      });
    } catch (error) {
      console.error('Error suggesting avatar:', error);
      alert('There was an error getting avatar suggestions. Please try again.');
    }
  });

  suggestAvatar = () => {
    this._suggestAvatar.perform();
  };

  isOptionSelected = (option: { value: string; label: string }) => {
    return this.currentSelection === option.value;
  };

  <template>
    <main class='avatar-creator-container'>
      <div class='avatar-creator'>
        <div class='avatar-display'>
          <div class='avatar-preview-container'>
            <div class='avatar-preview'>
              <img
                src={{this.avataaarsUrl}}
                alt='Avatar Avatar'
                class='avatar-image'
              />
            </div>

            {{#if @onCreateRealImage}}
              <BoxelButton
                @kind='primary'
                class='create-real-img-btn'
                {{on 'click' @onCreateRealImage}}
                disabled={{@isImageGenerating}}
              >
                {{#if @isImageGenerating}}
                  Generating...
                {{else}}
                  Make Real
                {{/if}}
              </BoxelButton>
            {{/if}}
          </div>

          {{#if @errorImageGenerating}}
            <div class='error-message'>
              {{@errorImageGenerating}}
            </div>
          {{/if}}

          {{#if @generatedImage}}
            <div class='realistic-preview-container'>
              <div class='realistic-preview'>
                <img
                  src={{@generatedImage}}
                  alt='Realistic Avatar'
                  class='realistic-image'
                />
              </div>
              <p class='realistic-label'>Realistic Version</p>
            </div>
          {{/if}}

          <div class='avatar-info'>
            <div class='url-copy-section'>
              <div class='url-display-row'>
                <BoxelInput
                  @value={{this.avataaarsUrl}}
                  @placeholder='Avatar URL'
                  @readonly={{true}}
                  @disabled={{true}}
                  class='url-input'
                  aria-label='Avatar URL'
                />
                <button
                  class='copy-btn {{if this.copySuccess "copied"}}'
                  {{on 'click' this.copyAvataaarsUrl}}
                  title='Copy Avatar URL'
                >
                  {{#if this.copySuccess}}
                    ✓
                  {{else}}
                    📋
                  {{/if}}
                </button>
              </div>
              {{#if this.copySuccess}}
                <div class='copy-feedback'>Avatar URL copied to clipboard!</div>
              {{/if}}
            </div>

            <div class='avatar-details'>
              {{#if this.topType}}
                <div class='detail-item'>
                  <strong>Hair:</strong>
                  {{this.topType}}
                </div>
              {{/if}}
              {{#if this.hairColor}}
                <div class='detail-item'>
                  <strong>Hair Color:</strong>
                  {{this.hairColor}}
                </div>
              {{/if}}
              {{#if this.mouthType}}
                <div class='detail-item'>
                  <strong>Mouth:</strong>
                  {{this.mouthType}}
                </div>
              {{/if}}
              {{#if this.skinColor}}
                <div class='detail-item'>
                  <strong>Skin:</strong>
                  {{this.skinColor}}
                </div>
              {{/if}}
              {{#if this.eyeType}}
                <div class='detail-item'>
                  <strong>Eyes:</strong>
                  {{this.eyeType}}
                </div>
              {{/if}}
              {{#if this.eyebrowType}}
                <div class='detail-item'>
                  <strong>Eyebrows:</strong>
                  {{this.eyebrowType}}
                </div>
              {{/if}}
              {{#if this.clotheType}}
                <div class='detail-item'>
                  <strong>Clothes:</strong>
                  {{this.clotheType}}
                </div>
              {{/if}}
            </div>
          </div>
        </div>

        <div class='customization-panel'>
          <div class='panel-header'>
            <h3>Customize Your Avatar</h3>
            <div class='header-buttons'>
              <BoxelButton
                @kind='secondary'
                @size='tall'
                class='random-btn'
                {{on 'click' this.generateRandomAvatar}}
              >
                🎲 Random
              </BoxelButton>
              <BoxelButton
                @kind='primary'
                @size='tall'
                class='ai-suggestion-btn'
                @loading={{this._suggestAvatar.isRunning}}
                {{on 'click' this.suggestAvatar}}
              >
                {{#if this._suggestAvatar.isRunning}}
                  🤖 Suggesting...
                {{else}}
                  ✨ AI Suggest
                {{/if}}
              </BoxelButton>
            </div>
          </div>

          <div class='category-nav'>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'hair')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "hair") "active"}}'
              data-category='hair'
              {{on 'click' (fn this.selectCategory 'hair')}}
            >
              Hair Style
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'hairColor')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "hairColor") "active"}}'
              data-category='hairColor'
              {{on 'click' (fn this.selectCategory 'hairColor')}}
            >
              Hair Color
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'eyes')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "eyes") "active"}}'
              data-category='eyes'
              {{on 'click' (fn this.selectCategory 'eyes')}}
            >
              Eyes
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'eyebrows')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "eyebrows") "active"}}'
              data-category='eyebrows'
              {{on 'click' (fn this.selectCategory 'eyebrows')}}
            >
              Eyebrows
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'mouth')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "mouth") "active"}}'
              data-category='mouth'
              {{on 'click' (fn this.selectCategory 'mouth')}}
            >
              Mouth
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'skinTone')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "skinTone") "active"}}'
              data-category='skinTone'
              {{on 'click' (fn this.selectCategory 'skinTone')}}
            >
              Skin
            </BoxelButton>
            <BoxelButton
              @kind={{if
                (eq this.selectedCategory 'clothes')
                'primary'
                'secondary'
              }}
              @size='small'
              class='category-btn
                {{if (eq this.selectedCategory "clothes") "active"}}'
              data-category='clothes'
              {{on 'click' (fn this.selectCategory 'clothes')}}
            >
              Clothes
            </BoxelButton>
          </div>

          <div class='styles-grid-container'>
            <h4>{{this.selectedCategory}} Options</h4>

            {{#if (gt this.currentCategoryOptions.length 0)}}
              <div class='styles-grid'>
                {{#each this.currentCategoryOptions as |option|}}
                  <button
                    type='button'
                    class='option-btn avataaars-option
                      {{if (this.isOptionSelected option) "selected"}}'
                    {{on 'click' (fn this.selectAvataaarsOption option)}}
                  >
                    <div class='option-preview'>
                      <div class='option-image'>
                        <img
                          src={{this.getOptionPreviewUrl option}}
                          alt={{option.label}}
                          class='preview-avatar'
                          loading='lazy'
                        />
                      </div>
                      <div class='option-label'>{{option.label}}</div>
                    </div>
                  </button>
                {{/each}}
              </div>
            {{else}}
              <div class='empty-styles'>No
                {{this.selectedCategory}}
                options available</div>
            {{/if}}
          </div>
        </div>
      </div>
    </main>

    <style scoped>
      .avatar-creator-container {
        container-type: inline-size;
      }
      .avatar-creator {
        display: grid;
        grid-template-columns: 420px 1fr;
        gap: var(--boxel-sp-xl);
        padding: var(--boxel-sp-xl);
        min-height: 100vh;
        background: var(--background, var(--boxel-650));
        color: var(--foreground, var(--boxel-100));
        position: relative;
        overflow: hidden;
        box-sizing: border-box;
      }

      .avatar-display {
        background: var(--color-card);
        border: 4px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--boxel-sp-xl);
        box-shadow: var(--boxel-box-shadow-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--boxel-sp-lg);
        position: relative;
        z-index: 1;
        animation: marioKartBounce 3s ease-in-out infinite;
        height: fit-content;
      }

      @keyframes marioKartBounce {
        0%,
        100% {
          transform: translateY(0px);
        }
        50% {
          transform: translateY(-8px);
        }
      }

      .avatar-preview-container {
        position: relative;
        width: fit-content;
        margin: 0 auto;
      }

      .avatar-preview {
        width: 280px;
        height: 280px;
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: var(--boxel-50);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.3s ease;
      }

      .create-real-img-btn {
        position: absolute;
        bottom: 12px;
        left: 50%;
        transform: translateX(-50%);
        padding: 0.5rem 1rem;
        font-size: 0.875rem;
        font-weight: 600;
        border-radius: 20px;
        background: rgba(0, 188, 212, 0.95);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        transition: all 0.3s ease;
        z-index: 10;
      }

      .create-real-img-btn:hover:not(:disabled) {
        background: rgba(0, 188, 212, 1);
        transform: translateX(-50%) translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 188, 212, 0.4);
      }

      .create-real-img-btn:disabled {
        background: rgba(128, 128, 128, 0.7);
        cursor: not-allowed;
      }

      .error-message {
        padding: 0.75rem;
        background: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--boxel-border-radius);
        color: #c62828;
        font-size: 0.875rem;
        text-align: center;
        margin-top: var(--boxel-sp);
      }

      .realistic-preview-container {
        position: relative;
        width: fit-content;
        margin: var(--boxel-sp-lg) auto 0;
        text-align: center;
      }

      .realistic-preview {
        width: 280px;
        height: 280px;
        border: 1px solid rgba(0, 0, 0, 0.15);
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: #ffffff;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        transition: all 0.3s ease;
        margin: 0 auto;
      }

      .realistic-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .realistic-label {
        margin-top: var(--boxel-sp);
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-foreground);
      }

      .avatar-preview:hover {
        transform: scale(1.05);
        box-shadow: 0 0 60px rgba(52, 152, 219, 0.6);
      }

      .realistic-preview:hover {
        transform: scale(1.05);
        box-shadow: 0 0 60px rgba(52, 152, 219, 0.6);
      }

      @keyframes marioKartRainbow {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      .avatar-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 18px;
        filter: brightness(1.1) contrast(1.05) saturate(1.1);
      }

      .avatar-info {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
      }

      /* URL Copy Section Styles - Following avatar.gts pattern */
      .url-copy-section {
        flex: 1;
      }

      .url-display-row {
        display: flex;
        gap: var(--boxel-sp-xs);
      }

      .url-input {
        flex: 1;
        padding: var(--boxel-sp-xs);
        border: 2px solid var(--boxel-border-color);
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-sm);
        background: var(--muted);
        color: var(--muted-foreground);
      }

      /* Override BoxelInput styles for URL input */
      .url-input :deep(input) {
        background: var(--boxel-light);
        border: 2px solid var(--background, var(--boxel-500));
        color: var(--foreground, var(--boxel-100));
        font-size: var(--boxel-font-size-sm);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
      }

      .url-input :deep(input:focus) {
        border-color: var(--background, var(--boxel-500));
        box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
      }

      .copy-btn {
        width: 40px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: var(
          --color-secondary,
          var(--secondary, var(--boxel-highlight))
        );
        color: var(--color-secondary-foreground, var(--secondary-foreground));
        border: none;
        border-radius: var(--boxel-border-radius-xs);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .copy-btn:hover {
        background: var(
          --color-secondary-hover,
          var(--secondary, var(--boxel-highlight-hover))
        );
        opacity: 0.8;
        transform: translateY(-1px);
      }

      .copy-btn.copied {
        background: var(--color-accent, var(--accent, var(--boxel-200)));
        color: var(
          --color-accent-foreground,
          var(--accent-foreground, var(--boxel-dark))
        );
      }

      .copy-feedback {
        margin-top: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs);
        background: rgba(39, 174, 96, 0.2);
        border: 1px solid var(--boxel-success);
        border-radius: var(--boxel-border-radius-xs);
        color: var(--boxel-success);
        font-size: var(--boxel-font-size-sm);
        text-align: center;
        animation: fadeInUp 0.3s ease;
      }

      @keyframes fadeInUp {
        from {
          opacity: 0;
          transform: translateY(10px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes textShimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }

      .avatar-details {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.75rem;
        width: 100%;
        background: var(--accent, rgba(52, 73, 94, 0.2));
        padding: 1.25rem;
        border-radius: 2px;
        border: 2px solid var(--background, rgba(255, 255, 255, 0.2));
        border-radius: var(--boxel-border-radius);
      }

      .detail-item {
        font-size: 0.875rem;
        color: var(--card-foreground, var(--boxel-100));
        background: var(--card, var(--boxel-400));
        padding: 0.75rem;
        border-radius: 2px;
        border-left: 4px solid var(--card-foreground, var(--boxel-highlight));
        font-weight: 600;
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .detail-item:hover::before {
        left: 100%;
      }

      .detail-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .detail-item strong {
        color: var(--card-foreground, var(--boxel-100));
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.5px;
        font-weight: 600;
        display: block;
        margin-bottom: 0.25rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customization-panel {
        background: var(--color-card);
        border: 3px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: var(--boxel-sp-lg);
        box-shadow: var(--boxel-box-shadow-lg);
        height: 100%;
        position: relative;
        z-index: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xl);
        padding-bottom: var(--boxel-sp);
        border-bottom: 1px solid var(--boxel-border-color);
      }

      .header-buttons {
        display: flex;
        gap: var(--boxel-sp);
        align-items: center;
      }

      .customization-panel h3 {
        margin: 0;
        color: var(--color-foreground);
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        letter-spacing: -0.025em;
        font-family: var(--font-body);
      }

      .category-nav {
        display: flex;
        justify-content: flex-start;
        gap: var(--boxel-sp-xs);
        margin-bottom: var(--boxel-sp-xl);
        flex-wrap: wrap;
        align-items: center;
        overflow-x: auto;
      }

      .category-nav .category-btn {
        text-transform: uppercase;
        letter-spacing: 0.5px;
        font-size: var(--boxel-font-size);
        font-weight: 600;
        flex: 1;
        min-width: 120px;
        justify-content: center;
        border-radius: var(--boxel-border-radius-xs);
        white-space: nowrap;
        flex-shrink: 0;
      }

      /* Override BoxelButton border radius for category buttons */
      .category-nav .category-btn :deep(button) {
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size);
        font-weight: 600;
        padding: var(--boxel-sp-sm) var(--boxel-sp);
      }

      /* Remove old category button specific styling since using BoxelButton */

      .styles-grid-container {
        flex: 1;
        background: var(--color-background);
        color: var(--color-foreground);
        padding: var(--boxel-sp-lg);
        border-radius: var(--radius-lg);
        border: 1px solid var(--color-border);
        overflow-y: auto;
        min-height: 0;
      }

      .styles-grid-container h4 {
        margin: 0 0 var(--boxel-sp-lg) 0;
        color: var(--color-foreground);
        font-size: var(--boxel-font-size);
        font-weight: 600;
        text-transform: capitalize;
        letter-spacing: -0.025em;
        font-family: var(--font-body);
      }

      .styles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: var(--boxel-sp);
        padding: 0;
      }

      .option-btn {
        aspect-ratio: 1;
        padding: var(--boxel-sp-xxs);
        background: var(--color-card, var(--boxel-300));
        border: 2px solid var(--color-border, var(--boxel-300));
        border-radius: var(--radius-lg, var(--boxel-border-radius));
        cursor: pointer;
        transition: all 0.2s ease;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .option-btn:hover {
        border: 2px solid var(--color-primary, var(--boxel-highlight));
        background: var(--color-accent, var(--boxel-light));
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }
      /* Keep selected state consistent on hover */
      .option-btn.selected:hover {
        background: var(--color-card, var(--boxel-light));
        border-color: var(--color-primary, var(--boxel-highlight));
        transform: scale(1.02); /* keep steady; outline handled by ::after */
        box-shadow: none;
      }

      .option-btn.selected {
        /* Reliable selected state with fallback colors */
        background: color-mix(
          in oklab,
          var(--color-primary, #00bcd4) 8%,
          var(--color-card, #ffffff)
        );
        border: 2px solid var(--color-primary, #00bcd4);
        position: relative;
        transform: scale(1.05);
        box-shadow:
          0 0 0 1px var(--color-primary, #00bcd4),
          0 4px 12px
            color-mix(in oklab, var(--color-primary, #00bcd4) 25%, transparent);
      }
      /* Clean focus ring that enhances rather than competes */
      .option-btn.selected::after {
        content: '';
        position: absolute;
        inset: -3px;
        border-radius: calc(var(--radius-lg, 8px) + 3px);
        background: linear-gradient(
          135deg,
          color-mix(in oklab, var(--color-primary, #00bcd4) 20%, transparent) 0%,
          color-mix(in oklab, var(--color-primary, #00bcd4) 5%, transparent)
            100%
        );
        border: 1px solid
          color-mix(in oklab, var(--color-primary, #00bcd4) 30%, transparent);
        pointer-events: none;
        z-index: -1;
      }

      .avataaars-option {
        min-height: 100px;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0.75rem;
      }

      .option-preview {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 0.5rem;
        text-align: center;
        width: 100%;
        height: 100%;
      }

      .option-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-xs);
        /* Remove drop-shadow so selection ring reads clearly */
        filter: none;
      }

      .avataaars-option .option-image {
        width: 52px;
        height: 52px;
        border: none;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        flex-shrink: 0;
        position: relative;
        filter: none; /* remove shadow to avoid muddy look */
      }

      .option-btn:hover .option-image {
        transform: scale(1.1) rotateZ(5deg);
      }

      .option-btn.selected .option-image {
        transform: scale(1.08);
        /* Elegant inner glow and ring with fallback colors */
        box-shadow:
          0 0 0 2px var(--color-background, #ffffff),
          0 0 0 3px var(--color-primary, #00bcd4),
          0 0 8px
            color-mix(in oklab, var(--color-primary, #00bcd4) 40%, transparent);
        border-radius: 50%;
      }

      .preview-avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        filter: brightness(1.1) contrast(1.05);
      }

      .option-label {
        font-size: var(--boxel-font-size-xs);
        color: var(--color-foreground);
        font-weight: 600;
        line-height: 1.3;
        max-width: 100%;
        text-transform: capitalize;
        transition: color 0.3s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 var(--boxel-sp-4xs);
        font-family: var(--font-body);
      }

      .option-btn:hover .option-label {
        color: var(--card-foreground, #333333);
        font-weight: 600;
      }

      .option-btn.selected .option-label {
        /* Enhanced text with subtle glow for premium feel and fallback color */
        color: var(--color-primary, #00bcd4);
        font-weight: 700;
        text-shadow: 0 0 4px
          color-mix(in oklab, var(--color-primary, #00bcd4) 30%, transparent);
        letter-spacing: 0.02em;
      }

      .header-buttons .random-btn,
      .header-buttons .ai-suggestion-btn {
        font-size: var(--boxel-font-size);
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--boxel-sp-xs);
      }

      /* Fix AI Suggest button contrast */
      .header-buttons .ai-suggestion-btn :deep(button) {
        background: linear-gradient(
          135deg,
          #00bcd4 0%,
          #0097a7 100%
        ) !important;
        color: #ffffff !important;
        border: 2px solid #00bcd4 !important;
        box-shadow: 0 0 20px rgba(0, 188, 212, 0.3);
      }

      .header-buttons .ai-suggestion-btn :deep(button:hover) {
        background: linear-gradient(
          135deg,
          #00d4e6 0%,
          #00a8b9 100%
        ) !important;
        color: #ffffff !important;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 188, 212, 0.4);
      }

      /* Fix category button contrast when selected - using consistent teal blue */
      .category-nav .category-btn.active :deep(button),
      .category-nav .category-btn[data-kind='primary'] :deep(button) {
        background: linear-gradient(
          135deg,
          #00bcd4 0%,
          #0097a7 100%
        ) !important;
        color: #ffffff !important;
        border: 2px solid #00bcd4 !important;
        font-weight: 700;
        box-shadow: 0 0 15px rgba(0, 188, 212, 0.3);
      }

      .category-nav .category-btn.active :deep(button:hover),
      .category-nav .category-btn[data-kind='primary'] :deep(button:hover) {
        background: linear-gradient(
          135deg,
          #00d4e6 0%,
          #00a8b9 100%
        ) !important;
        color: #ffffff !important;
        box-shadow: 0 0 20px rgba(0, 188, 212, 0.4);
      }

      .empty-styles {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 200px;
        color: var(--muted);
        font-size: var(--boxel-font-size-sm);
        text-align: center;
        font-style: italic;
      }

      /* Container Queries for Responsive Design */
      @container (width <= 900px) {
        .avatar-creator {
          grid-template-columns: 320px 1fr;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }

        .avatar-preview,
        .realistic-preview {
          width: 200px;
          height: 200px;
        }

        .avatar-display {
          padding: var(--boxel-sp);
        }

        .customization-panel {
          padding: var(--boxel-sp);
        }
      }

      @container (width <= 720px) {
        .avatar-creator {
          grid-template-columns: 1fr;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp);
        }

        .avatar-display {
          width: 100%;
        }

        .avatar-preview,
        .realistic-preview {
          width: 180px;
          height: 180px;
        }

        .avatar-details {
          display: none;
        }
      }

      @container (width <= 600px) {
        .avatar-creator {
          padding: var(--boxel-sp-xs);
          gap: var(--boxel-sp-xs);
        }

        .avatar-display {
          flex-direction: column;
          align-items: stretch;
        }

        .avatar-preview,
        .realistic-preview {
          width: 160px;
          height: 160px;
          align-self: center;
        }

        .avatar-info {
          gap: var(--boxel-sp-xs);
        }

        .url-copy-section {
          margin-bottom: var(--boxel-sp-xs);
        }

        .header-buttons {
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .styles-grid {
          gap: var(--boxel-sp-xs);
        }
      }

      @container (width <= 400px) {
        .avatar-creator {
          padding: var(--boxel-sp-xxs);
          gap: var(--boxel-sp-xxs);
        }

        .avatar-preview,
        .realistic-preview {
          width: 140px;
          height: 140px;
        }

        .panel-header {
          flex-direction: column;
          align-items: stretch;
          gap: var(--boxel-sp-xs);
        }

        .header-buttons {
          flex-direction: row;
          justify-content: center;
        }

        .category-nav {
          flex-direction: row;
          flex-wrap: nowrap;
          gap: var(--boxel-sp-4xs);
          overflow-x: auto;
        }

        .styles-grid {
          grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
          gap: var(--boxel-sp-4xs);
        }

        .customization-panel h3 {
          font-size: var(--boxel-font-size);
          text-align: center;
        }
      }

      @container (width <= 300px) {
        .avatar-preview,
        .realistic-preview {
          width: 120px;
          height: 120px;
        }

        .url-display-row {
          flex-direction: column;
          gap: var(--boxel-sp-xs);
        }

        .copy-btn {
          width: 100%;
          height: 48px;
        }

        .url-input {
          width: 100%;
        }

        .styles-grid {
          grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
          gap: var(--boxel-sp-5xs);
        }

        .header-buttons {
          flex-direction: column;
        }
      }

      /* Scrollbar styling */
      .customization-panel::-webkit-scrollbar {
        width: 8px;
      }

      .customization-panel::-webkit-scrollbar-track {
        background: rgba(255, 255, 255, 0.05);
        border-radius: 4px;
      }

      .customization-panel::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.2);
        border-radius: 4px;
      }

      .customization-panel::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.3);
      }
    </style>
  </template>
}
