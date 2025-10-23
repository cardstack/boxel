import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { task } from 'ember-concurrency';
import {
  FilterList,
  BoxelButton,
  BoxelInput,
} from '@cardstack/boxel-ui/components';

import {
  AvataaarsModel,
  DEFAULT_AVATAR_VALUES,
  CATEGORY_MAP,
  PRESET_AVATAR_SETS,
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
}

export default class AvatarComponent extends Component<AvatarCreatorArgs> {
  @tracked selectedCategory = 'hair';
  @tracked activeFilter: any = null;
  @tracked copySuccess = false;
  @tracked currentMode: 'presets' | 'customized' = 'presets';

  // Store filter objects to maintain reference equality
  private presetFilter = {
    displayName: 'Presets',
    mode: 'presets' as const,
  };

  private customizedFilter = {
    displayName: 'Customized',
    filters: [] as any[], // Will be populated in getter
    isExpanded: false,
  };

  constructor(owner: any, args: AvatarCreatorArgs) {
    super(owner, args);
    // Set initial active filter to Presets
    this.activeFilter = this.presetFilter;
  }

  // Generate categories from CATEGORY_MAP to keep things DRY
  get categories() {
    const categoryLabels: Record<string, string> = {
      hair: 'Hair Style',
      hairColor: 'Hair Color',
      eyes: 'Eyes',
      eyebrows: 'Eyebrows',
      mouth: 'Mouth',
      skinTone: 'Skin Tone',
      clothes: 'Clothes',
    };

    return Object.keys(CATEGORY_MAP).map((key) => ({
      key,
      label: categoryLabels[key] || key,
    }));
  }

  // Store category filter objects to maintain reference equality
  private _categoryFilters = new Map<string, any>();

  private getCategoryFilter(category: { key: string; label: string }) {
    if (!this._categoryFilters.has(category.key)) {
      this._categoryFilters.set(category.key, {
        displayName: category.label,
        categoryKey: category.key,
        mode: 'customized' as const,
      });
    }
    return this._categoryFilters.get(category.key);
  }

  // Transform into FilterList format with Presets and Customized
  get avatarFilters() {
    // Custom category filters with stable references
    const categoryFilters = this.categories.map((category) =>
      this.getCategoryFilter(category),
    );

    // Update the customized filter with current state
    this.customizedFilter.filters = categoryFilters;
    this.customizedFilter.isExpanded = this.currentMode === 'customized';

    return [this.presetFilter, this.customizedFilter];
  }

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

  // Get preset avatar sets with their URLs for display
  get presetAvatarOptions() {
    return PRESET_AVATAR_SETS.map((avatarSet) => ({
      name: avatarSet.name,
      url: getAvataarsUrl(avatarSet.model),
      model: avatarSet.model,
    }));
  }

  onFilterChanged = (filter: any) => {
    // Handle presets selection
    if (filter.mode === 'presets') {
      this.currentMode = 'presets';
      this.activeFilter = this.presetFilter;
    }
    // Handle customized category filter selection
    else if (filter.mode === 'customized' && filter.categoryKey) {
      this.currentMode = 'customized';
      this.selectedCategory = filter.categoryKey;
      this.activeFilter = filter; // This should now be from our cached objects
    }
    // Handle customized parent selection (expand/collapse)
    else if (filter.displayName === 'Customized') {
      // Don't change activeFilter for the parent, just toggle expansion
      this.currentMode = 'customized';
    }
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

  selectPresetAvatar = (avatarOption: any) => {
    playClickSound();
    // Apply the selected preset avatar
    this.currentModel = new TrackedMap(Object.entries(avatarOption.model));
    this.args.onUpdate?.(avatarOption.model);
  };

  // Check if a preset avatar is currently selected
  isPresetSelected = (avatarOption: any) => {
    const currentModelObj = Object.fromEntries(this.currentModel.entries());

    // Compare all avatar properties to see if this preset matches current state
    return (
      currentModelObj.topType === avatarOption.model.topType &&
      currentModelObj.accessoriesType === avatarOption.model.accessoriesType &&
      currentModelObj.hairColor === avatarOption.model.hairColor &&
      currentModelObj.facialHairType === avatarOption.model.facialHairType &&
      currentModelObj.clotheType === avatarOption.model.clotheType &&
      currentModelObj.eyeType === avatarOption.model.eyeType &&
      currentModelObj.eyebrowType === avatarOption.model.eyebrowType &&
      currentModelObj.mouthType === avatarOption.model.mouthType &&
      currentModelObj.skinColor === avatarOption.model.skinColor
    );
  };

  <template>
    <div class='avatar-compact'>
      <div class='avatar-header'>
        <div class='avatar-preview'>
          <img src={{this.avataaarsUrl}} alt='Avatar' class='avatar-image' />
        </div>

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
        </div>
      </div>

      <div class='avatar-content'>
        <div class='sidebar'>

          <FilterList
            @filters={{this.avatarFilters}}
            @activeFilter={{this.activeFilter}}
            @onChanged={{this.onFilterChanged}}
            class='filter-section'
          />

          <div class='ai-section'>
            <div class='ai-buttons'>
              <BoxelButton
                @kind='primary'
                @size='small'
                class='ai-suggest-btn'
                @loading={{this._suggestAvatar.isRunning}}
                {{on 'click' this.suggestAvatar}}
              >
                {{#if this._suggestAvatar.isRunning}}
                  🤖 Suggesting...
                {{else}}
                  ✨ Suggest Avatar
                {{/if}}
              </BoxelButton>
              <BoxelButton
                @kind='secondary'
                @size='small'
                class='random-btn'
                {{on 'click' this.generateRandomAvatar}}
              >
                🎲 Random
              </BoxelButton>
            </div>
          </div>
        </div>

        <div class='options-content'>
          {{#if (eq this.currentMode 'presets')}}
            <div class='options-header'>
              <h3>Preset Avatars</h3>
            </div>

            <div class='options-grid'>
              {{#each this.presetAvatarOptions as |avatarOption|}}
                <button
                  type='button'
                  class='option-btn preset-avatar
                    {{if (this.isPresetSelected avatarOption) "selected"}}'
                  {{on 'click' (fn this.selectPresetAvatar avatarOption)}}
                  title={{avatarOption.name}}
                >
                  <img
                    src={{avatarOption.url}}
                    alt={{avatarOption.name}}
                    class='option-image'
                    loading='lazy'
                  />
                  <div class='avatar-name'>{{avatarOption.name}}</div>
                </button>
              {{/each}}
            </div>
          {{else}}
            <div class='options-header'>
              <h3>{{this.selectedCategory}} Options</h3>
            </div>

            {{#if (gt this.currentCategoryOptions.length 0)}}
              <div class='options-grid'>
                {{#each this.currentCategoryOptions as |option|}}
                  <button
                    type='button'
                    class='option-btn
                      {{if (this.isOptionSelected option) "selected"}}'
                    {{on 'click' (fn this.selectAvataaarsOption option)}}
                    title={{option.label}}
                  >
                    <img
                      src={{this.getOptionPreviewUrl option}}
                      alt={{option.label}}
                      class='option-image'
                      loading='lazy'
                    />
                  </button>
                {{/each}}
              </div>
            {{else}}
              <div class='empty-state'>
                No
                {{this.selectedCategory}}
                options available
              </div>
            {{/if}}
          {{/if}}
        </div>
      </div>
    </div>

    <style scoped>
      .avatar-compact {
        container-type: inline-size;
        background: var(
          --color-background,
          var(--background, var(--boxel-650))
        );
        color: var(--color-foreground, var(--foreground, var(--boxel-100)));
        border: 3px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        min-height: 400px;
        position: relative;
        backdrop-filter: blur(15px);
        box-shadow: var(--boxel-box-shadow-lg);
      }

      .avatar-header {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp);
        padding: var(--boxel-sp);
        background: var(--color-card, var(--card));
        color: var(--color-card-foreground, var(--card-foreground));
        border-bottom: 2px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        position: relative;
        z-index: 1;
      }

      .avatar-preview {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        overflow: hidden;
        border: 3px solid var(--color-accent, var(--accent));
        flex-shrink: 0;
        background: var(--color-accent, var(--accent, var(--boxel-200)));
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
      }

      .avatar-preview:hover {
        transform: scale(1.05);
        box-shadow: 0 0 30px var(--color-accent, var(--accent));
      }

      .avatar-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        filter: brightness(1.1) contrast(1.05) saturate(1.1);
        border-radius: 50%;
      }

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
        border: 2px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        border-radius: var(--boxel-border-radius-xs);
        font-size: var(--boxel-font-size-sm);
        background: var(--color-muted, var(--muted));
        color: var(--color-muted-foreground, var(--muted-foreground));
      }

      /* Override BoxelInput styles for URL input */
      .url-input :deep(input) {
        background: var(--color-input, var(--input));
        border: 2px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        color: var(--color-foreground, var(--foreground, var(--boxel-100)));
        font-size: var(--boxel-font-size-sm);
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius-xs);
      }

      .url-input :deep(input:focus) {
        border-color: var(--color-ring, var(--ring));
        box-shadow: 0 0 0 2px var(--color-ring, var(--ring));
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

      .avatar-content {
        display: flex;
        min-height: 300px;
        position: relative;
        z-index: 1;
      }

      .sidebar {
        width: 200px;
        border-right: 2px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        display: flex;
        flex-direction: column;
      }

      .filter-section {
        padding: var(--boxel-sp-xs);
        border-bottom: 1px solid
          var(--color-border, var(--border, var(--boxel-border-color)));
        --boxel-filter-expanded-background: transparent;
        --boxel-filter-hover-background: var(
          --color-accent,
          var(--accent, var(--boxel-200))
        );
        --boxel-filter-hover-foreground: var(
          --color-accent-foreground,
          var(--accent-foreground, var(--boxel-500))
        );
        --boxel-filter-selected-background: var(
          --color-accent,
          var(--accent, var(--boxel-200))
        );
        --boxel-filter-selected-foreground: var(
          --color-accent-foreground,
          var(--accent-foreground, var(--boxel-500))
        );
        --boxel-filter-selected-hover-background: var(
          --color-accent,
          var(--accent, var(--boxel-200))
        );
        --boxel-filter-selected-hover-foreground: var(
          --color-accent-foreground,
          var(--accent-foreground, var(--boxel-500))
        );
      }

      .filter-section :deep(.filter-list-item) {
        margin-bottom: var(--boxel-sp-4xs);
      }

      .filter-section :deep(.filter-list__button) {
        font-size: var(--boxel-font-size-sm);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border-radius: var(--boxel-border-radius-xs);
      }

      .ai-section {
        padding: var(--boxel-sp-sm);
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        background: var(--color-card, var(--card));
      }

      .ai-title {
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        color: var(--color-card-foreground, var(--card-foreground));
        margin: 0 0 var(--boxel-sp-xs) 0;
      }

      .ai-buttons {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
      }

      /* Override BoxelUI button styles for better sidebar fit */
      .ai-section .ai-suggest-btn,
      .ai-section .random-btn {
        width: 100%;
        justify-content: center;
        font-weight: 600;
      }

      .options-content {
        flex: 1;
        padding: var(--boxel-sp);
      }

      .options-header h3 {
        margin: 0 0 var(--boxel-sp) 0;
        font-size: var(--boxel-font-size-lg);
        color: var(--color-foreground, var(--foreground, var(--boxel-100)));
        font-weight: 600;
        text-transform: capitalize;
        letter-spacing: -0.025em;
      }

      .options-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
        gap: var(--boxel-sp-xs);
      }

      /* Adjust grid for preset avatars */
      .options-content:has(.preset-avatar) .options-grid {
        grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
      }

      .option-btn {
        aspect-ratio: 1;
        padding: var(--boxel-sp-xxs);
        background: var(--color-card, var(--boxel-300));
        border: 2px solid var(--color-border, var(--boxel-300));
        border-radius: var(--boxel-border-radius);
        cursor: pointer;
        transition: all 0.2s ease;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        position: relative;
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

      .option-btn:hover .option-image {
        transform: scale(1.05) rotateZ(2deg);
      }

      .option-btn.selected .option-image {
        transform: scale(1.02);
      }

      .option-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: var(--boxel-border-radius-xs);
        filter: brightness(1.05) contrast(1.05) saturate(1.05);
        transition: all 0.3s ease;
      }

      .preset-avatar .option-image {
        width: 60px;
        height: 60px;
        flex-shrink: 0;
        border-radius: 50%;
        border: none;
      }

      .avatar-name {
        margin-top: var(--boxel-sp-xs);
        font-size: var(--boxel-font-size-xs);
        font-weight: 600;
        text-align: center;
        color: var(--color-card-foreground, var(--card-foreground));
        line-height: 1.2;
        transition: all 0.3s ease;
      }

      .empty-state,
      .ai-info {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 200px;
        color: var(--color-muted-foreground, var(--muted-foreground));
        font-style: italic;
        font-size: var(--boxel-font-size-sm);
      }

      /* Container Queries for Responsive Design */
      @container (width <= 600px) {
        .avatar-content {
          flex-direction: column;
        }

        .sidebar {
          width: 100%;
          min-height: auto;
        }

        .filter-section {
          flex: 1;
          border-right: 1px solid
            var(--color-border, var(--border, var(--boxel-border-color)));
          border-bottom: none;
        }

        .ai-section {
          min-width: 150px;
          border-bottom: 1px solid
            var(--color-border, var(--border, var(--boxel-border-color)));
        }

        .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
        }

        /* Adjust preset avatar grid for tablet */
        .options-content:has(.preset-avatar) .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        }
      }

      @container (width <= 400px) {
        .avatar-header {
          flex-direction: column;
          align-items: stretch;
          gap: var(--boxel-sp-sm);
        }

        .avatar-preview {
          align-self: center;
        }

        .sidebar {
          flex-direction: column;
        }

        .filter-section {
          border-right: none;
          border-bottom: 1px solid
            var(--color-border, var(--border, var(--boxel-border-color)));
        }

        .ai-section {
          min-width: auto;
        }

        .ai-buttons {
          flex-direction: row;
        }

        .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(45px, 1fr));
          gap: var(--boxel-sp-4xs);
        }

        /* Adjust preset avatar grid for mobile */
        .options-content:has(.preset-avatar) .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
        }
      }

      @container (width <= 300px) {
        .avatar-header {
          padding: var(--boxel-sp-xs);
        }

        .options-content {
          padding: var(--boxel-sp-xs);
        }

        .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
          gap: var(--boxel-sp-5xs);
        }

        .ai-buttons {
          flex-direction: column;
        }

        /* Adjust preset avatar grid for tiny screens */
        .options-content:has(.preset-avatar) .options-grid {
          grid-template-columns: repeat(auto-fill, minmax(80px, 1fr));
        }
      }
    </style>
  </template>
}
