import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { eq, gt } from '@cardstack/boxel-ui/helpers';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { TrackedMap } from 'tracked-built-ins';
import { task } from 'ember-concurrency';

import UseAiAssistantCommand from '@cardstack/boxel-host/commands/ai-assistant';
import SetActiveLLMCommand from '@cardstack/boxel-host/commands/set-active-llm';

export interface AvataaarsModel {
  topType?: string;
  accessoriesType?: string;
  hairColor?: string;
  facialHairType?: string;
  clotheType?: string;
  eyeType?: string;
  eyebrowType?: string;
  mouthType?: string;
  skinColor?: string;
}

interface AvatarCreatorArgs {
  model: AvataaarsModel;
  name?: string;
  context?: any;
}

export default class AvatarCreator extends Component<AvatarCreatorArgs> {
  @tracked selectedCategory = 'hair';
  @tracked copySuccess = false;
  roomId: string | null = null;

  // Internal mutable avatar state using TrackedMap
  @tracked currentModel = new TrackedMap([
    ['topType', this.args.model?.topType || 'ShortHairShortFlat'],
    ['accessoriesType', this.args.model?.accessoriesType || 'Blank'],
    ['hairColor', this.args.model?.hairColor || 'BrownDark'],
    ['facialHairType', this.args.model?.facialHairType || 'Blank'],
    ['clotheType', this.args.model?.clotheType || 'BlazerShirt'],
    ['eyeType', this.args.model?.eyeType || 'Default'],
    ['eyebrowType', this.args.model?.eyebrowType || 'Default'],
    ['mouthType', this.args.model?.mouthType || 'Default'],
    ['skinColor', this.args.model?.skinColor || 'Light'],
  ]);

  // Avataaars configuration options with comprehensive styling
  avataaarsOptions = {
    topType: [
      { value: 'NoHair', label: 'Bald' },
      { value: 'Eyepatch', label: 'Eyepatch' },
      { value: 'Hat', label: 'Hat' },
      { value: 'Hijab', label: 'Hijab' },
      { value: 'Turban', label: 'Turban' },
      { value: 'WinterHat1', label: 'Winter Hat 1' },
      { value: 'WinterHat2', label: 'Winter Hat 2' },
      { value: 'WinterHat3', label: 'Winter Hat 3' },
      { value: 'WinterHat4', label: 'Winter Hat 4' },
      { value: 'LongHairBigHair', label: 'Big Hair' },
      { value: 'LongHairBob', label: 'Bob Cut' },
      { value: 'LongHairBun', label: 'Hair Bun' },
      { value: 'LongHairCurly', label: 'Curly Hair' },
      { value: 'LongHairCurvy', label: 'Curvy Hair' },
      { value: 'LongHairDreads', label: 'Dreadlocks' },
      { value: 'LongHairFro', label: 'Afro' },
      { value: 'LongHairFroBand', label: 'Afro with Band' },
      { value: 'LongHairNotTooLong', label: 'Medium Hair' },
      { value: 'LongHairShavedSides', label: 'Shaved Sides' },
      { value: 'LongHairMiaWallace', label: 'Mia Wallace' },
      { value: 'LongHairStraight', label: 'Straight Hair' },
      { value: 'LongHairStraight2', label: 'Straight Hair 2' },
      { value: 'LongHairStraightStrand', label: 'Hair Strand' },
      { value: 'ShortHairDreads01', label: 'Short Dreads 1' },
      { value: 'ShortHairDreads02', label: 'Short Dreads 2' },
      { value: 'ShortHairFrizzle', label: 'Frizzled Hair' },
      { value: 'ShortHairShaggyMullet', label: 'Shaggy Mullet' },
      { value: 'ShortHairShortCurly', label: 'Short Curly' },
      { value: 'ShortHairShortFlat', label: 'Short Flat' },
      { value: 'ShortHairShortRound', label: 'Short Round' },
      { value: 'ShortHairShortWaved', label: 'Short Waved' },
      { value: 'ShortHairSides', label: 'Hair Sides' },
      { value: 'ShortHairTheCaesar', label: 'Caesar Cut' },
      { value: 'ShortHairTheCaesarSidePart', label: 'Caesar Side Part' },
    ],
    hairColor: [
      { value: 'Auburn', label: 'Auburn' },
      { value: 'Black', label: 'Black' },
      { value: 'Blonde', label: 'Blonde' },
      { value: 'BlondeGolden', label: 'Golden Blonde' },
      { value: 'Brown', label: 'Brown' },
      { value: 'BrownDark', label: 'Dark Brown' },
      { value: 'PastelPink', label: 'Pastel Pink' },
      { value: 'Blue', label: 'Blue' },
      { value: 'Platinum', label: 'Platinum' },
      { value: 'Red', label: 'Red' },
      { value: 'SilverGray', label: 'Silver Gray' },
    ],
    eyeType: [
      { value: 'Close', label: 'Closed' },
      { value: 'Cry', label: 'Crying' },
      { value: 'Default', label: 'Default' },
      { value: 'Dizzy', label: 'Dizzy' },
      { value: 'EyeRoll', label: 'Eye Roll' },
      { value: 'Happy', label: 'Happy' },
      { value: 'Hearts', label: 'Hearts' },
      { value: 'Side', label: 'Side Glance' },
      { value: 'Squint', label: 'Squint' },
      { value: 'Surprised', label: 'Surprised' },
      { value: 'Wink', label: 'Wink' },
      { value: 'WinkWacky', label: 'Wacky Wink' },
    ],
    eyebrowType: [
      { value: 'Angry', label: 'Angry' },
      { value: 'AngryNatural', label: 'Angry Natural' },
      { value: 'Default', label: 'Default' },
      { value: 'DefaultNatural', label: 'Default Natural' },
      { value: 'FlatNatural', label: 'Flat Natural' },
      { value: 'RaisedExcited', label: 'Raised Excited' },
      { value: 'RaisedExcitedNatural', label: 'Raised Excited Natural' },
      { value: 'SadConcerned', label: 'Sad Concerned' },
      { value: 'SadConcernedNatural', label: 'Sad Concerned Natural' },
      { value: 'UnibrowNatural', label: 'Unibrow Natural' },
      { value: 'UpDown', label: 'Up Down' },
      { value: 'UpDownNatural', label: 'Up Down Natural' },
    ],
    mouthType: [
      { value: 'Concerned', label: 'Concerned' },
      { value: 'Default', label: 'Default' },
      { value: 'Disbelief', label: 'Disbelief' },
      { value: 'Eating', label: 'Eating' },
      { value: 'Grimace', label: 'Grimace' },
      { value: 'Sad', label: 'Sad' },
      { value: 'ScreamOpen', label: 'Scream Open' },
      { value: 'Serious', label: 'Serious' },
      { value: 'Smile', label: 'Smile' },
      { value: 'Tongue', label: 'Tongue Out' },
      { value: 'Twinkle', label: 'Twinkle' },
      { value: 'Vomit', label: 'Vomit' },
    ],
    skinColor: [
      { value: 'Tanned', label: 'Tanned' },
      { value: 'Yellow', label: 'Yellow' },
      { value: 'Pale', label: 'Pale' },
      { value: 'Light', label: 'Light' },
      { value: 'Brown', label: 'Brown' },
      { value: 'DarkBrown', label: 'Dark Brown' },
      { value: 'Black', label: 'Black' },
    ],
    clotheType: [
      { value: 'BlazerShirt', label: 'Blazer & Shirt' },
      { value: 'BlazerSweater', label: 'Blazer & Sweater' },
      { value: 'CollarSweater', label: 'Collar Sweater' },
      { value: 'GraphicShirt', label: 'Graphic Shirt' },
      { value: 'Hoodie', label: 'Hoodie' },
      { value: 'Overall', label: 'Overall' },
      { value: 'ShirtCrewNeck', label: 'Crew Neck Shirt' },
      { value: 'ShirtScoopNeck', label: 'Scoop Neck Shirt' },
      { value: 'ShirtVNeck', label: 'V-Neck Shirt' },
    ],
  };

  // <ui label> = <avataarsUrl param>
  categoryMap: Record<string, keyof typeof this.avataaarsOptions> = {
    hair: 'topType',
    eyes: 'eyeType',
    eyebrows: 'eyebrowType',
    mouth: 'mouthType',
    skinTone: 'skinColor',
    clothes: 'clotheType',
    hairColor: 'hairColor',
  };

  // Get Avataaars URL for the image
  get avataaarsUrl() {
    // Convert TrackedMap to object for getAvataarsUrl function
    const modelObj = Object.fromEntries(this.currentModel.entries());
    return getAvataarsUrl(modelObj as AvataaarsModel);
  }

  get currentCategoryOptions() {
    const paramName = this.categoryMap[this.selectedCategory];
    return this.avataaarsOptions[paramName] || [];
  }

  selectCategory = (category: string) => {
    this.selectedCategory = category;
  };

  generateRandomAvatar = () => {
    // Play click sound
    this.playClickSound();
    debugger;

    // Get random options from each category
    const randomHair =
      this.avataaarsOptions.topType[
        Math.floor(Math.random() * this.avataaarsOptions.topType.length)
      ];
    const randomHairColor =
      this.avataaarsOptions.hairColor[
        Math.floor(Math.random() * this.avataaarsOptions.hairColor.length)
      ];
    const randomEyes =
      this.avataaarsOptions.eyeType[
        Math.floor(Math.random() * this.avataaarsOptions.eyeType.length)
      ];
    const randomEyebrows =
      this.avataaarsOptions.eyebrowType[
        Math.floor(Math.random() * this.avataaarsOptions.eyebrowType.length)
      ];
    const randomMouth =
      this.avataaarsOptions.mouthType[
        Math.floor(Math.random() * this.avataaarsOptions.mouthType.length)
      ];
    const randomSkinTone =
      this.avataaarsOptions.skinColor[
        Math.floor(Math.random() * this.avataaarsOptions.skinColor.length)
      ];
    const randomClothes =
      this.avataaarsOptions.clotheType[
        Math.floor(Math.random() * this.avataaarsOptions.clotheType.length)
      ];

    // Apply random selections to internal state - reassign entire TrackedMap
    this.currentModel = new TrackedMap([
      ['topType', randomHair.value],
      ['accessoriesType', 'Blank'],
      ['hairColor', randomHairColor.value],
      ['facialHairType', 'Blank'],
      ['clotheType', randomClothes.value],
      ['eyeType', randomEyes.value],
      ['eyebrowType', randomEyebrows.value],
      ['mouthType', randomMouth.value],
      ['skinColor', randomSkinTone.value],
    ]);
  };

  selectAvataaarsOption = (option: { value: string; label: string }) => {
    // Update internal avatar state
    switch (this.selectedCategory) {
      case 'hair':
        this.currentModel.set('topType', option.value);
        break;
      case 'hairColor':
        this.currentModel.set('hairColor', option.value);
        break;
      case 'eyes':
        this.currentModel.set('eyeType', option.value);
        break;
      case 'eyebrows':
        this.currentModel.set('eyebrowType', option.value);
        break;
      case 'mouth':
        this.currentModel.set('mouthType', option.value);
        break;
      case 'skinTone':
        this.currentModel.set('skinColor', option.value);
        break;
      case 'clothes':
        this.currentModel.set('clotheType', option.value);
        break;
    }
  };

  copyAvataaarsUrl = () => {
    try {
      // Play click sound
      this.playClickSound();
      navigator.clipboard.writeText(this.avataaarsUrl);
      this.copySuccess = true;
      // Reset success state after 2 seconds
      //DO WE NEED THIS?
      setTimeout(() => {
        this.copySuccess = false;
      }, 2000);
    } catch (error) {
      console.error('Failed to copy URL:', error);
    }
  };

  // Create a click sound using Web Audio API
  playClickSound() {
    try {
      const audioContext = new (window.AudioContext ||
        (window as any).webkitAudioContext)();

      // Create oscillator for the click sound
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Configure the sound - a short, crisp click
      oscillator.frequency.setValueAtTime(800, audioContext.currentTime); // High frequency for crisp sound
      oscillator.frequency.exponentialRampToValueAtTime(
        400,
        audioContext.currentTime + 0.1,
      );

      // Set volume envelope for a quick click
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(
        0.3,
        audioContext.currentTime + 0.01,
      ); // Quick attack
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.1,
      ); // Quick decay

      // Play the sound
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (error) {
      console.log('Audio not supported or failed:', error);
      // Silently fail if audio is not supported
    }
  }

  // Generate preview URL for each option
  getOptionPreviewUrl = (option: { value: string; label: string }) => {
    // Create a temporary model with the option applied for preview
    const previewModel = Object.fromEntries(this.currentModel.entries());

    switch (this.selectedCategory) {
      case 'hair':
        previewModel.topType = option.value;
        break;
      case 'hairColor':
        previewModel.hairColor = option.value;
        break;
      case 'eyes':
        previewModel.eyeType = option.value;
        break;
      case 'eyebrows':
        previewModel.eyebrowType = option.value;
        break;
      case 'mouth':
        previewModel.mouthType = option.value;
        break;
      case 'skinTone':
        previewModel.skinColor = option.value;
        break;
      case 'clothes':
        previewModel.clotheType = option.value;
        break;
    }

    return getAvataarsUrl(previewModel as AvataaarsModel);
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
      switch (this.selectedCategory) {
        case 'hair':
          return this.topType;
        case 'hairColor':
          return this.hairColor;
        case 'eyes':
          return this.eyeType;
        case 'eyebrows':
          return this.eyebrowType;
        case 'mouth':
          return this.mouthType;
        case 'skinTone':
          return this.skinColor;
        case 'clothes':
          return this.clotheType;
        default:
          return null;
      }
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
      if (!this.roomId) {
        let useAiAssistantCommand = new UseAiAssistantCommand(commandContext);
        let result = await useAiAssistantCommand.execute({
          roomName: `Avatar Suggestions: ${this.args.name || 'Unnamed Avatar'}`,
          openRoom: true,
          prompt:
            'Please edit the following card with an avatar based upon params of https://getavataaars.com/. The params supported are: topType, accessoriesType, hairColor, facialHairType, clotheType, eyeType, eyebrowType, mouthType and skinColor.',
        });

        this.roomId = result.roomId;

        let setActiveLLMCommand = new SetActiveLLMCommand(commandContext);
        await setActiveLLMCommand.execute({
          roomId: this.roomId,
          mode: 'act',
        });
      }
      if (!this.roomId) {
        throw new Error('Room setup failed');
      }
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
    <div class='avatar-creator'>
      <div class='avatar-display'>
        <div class='avatar-preview'>
          <img
            src={{this.avataaarsUrl}}
            alt='Avatar Avatar'
            class='avatar-image'
          />
        </div>

        <div class='avatar-info'>
          <h2>{{if @name @name 'Unnamed Avatar'}}</h2>

          <div class='url-copy-section'>
            <div class='url-display-row'>
              <label for='avatar-url-input' class='sr-only'>Avatar URL</label>
              <input
                id='avatar-url-input'
                type='text'
                value={{this.avataaarsUrl}}
                class='url-input'
                readonly
                placeholder='Avatar URL will appear here'
              />
              <button
                class='copy-btn {{if this.copySuccess "copied"}}'
                {{on 'click' this.copyAvataaarsUrl}}
                title='Copy Avatar URL'
              >
                {{#if this.copySuccess}}
                  ✓
                {{else}}
                  <svg
                    class='copy-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <rect
                      x='9'
                      y='9'
                      width='13'
                      height='13'
                      rx='2'
                      ry='2'
                    ></rect>
                    <path
                      d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'
                    ></path>
                  </svg>
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
            <button
              class='random-btn'
              {{on 'click' this.generateRandomAvatar}}
              title='Generate Random Avatar'
            >
              🎲 Random
            </button>
            <button
              class='ai-suggestion-btn'
              {{on 'click' this.suggestAvatar}}
              disabled={{this._suggestAvatar.isRunning}}
              title='Get AI Avatar Suggestions'
            >
              {{#if this._suggestAvatar.isRunning}}
                🤖 Suggesting...
              {{else}}
                🤖 AI Suggest
              {{/if}}
            </button>
          </div>
        </div>

        <div class='category-nav'>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "hair") "active"}}'
            data-category='hair'
            {{on 'click' (fn this.selectCategory 'hair')}}
          >
            Hair Style
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "hairColor") "active"}}'
            data-category='hairColor'
            {{on 'click' (fn this.selectCategory 'hairColor')}}
          >
            Hair Color
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "eyes") "active"}}'
            data-category='eyes'
            {{on 'click' (fn this.selectCategory 'eyes')}}
          >
            Eyes
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "eyebrows") "active"}}'
            data-category='eyebrows'
            {{on 'click' (fn this.selectCategory 'eyebrows')}}
          >
            Eyebrows
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "mouth") "active"}}'
            data-category='mouth'
            {{on 'click' (fn this.selectCategory 'mouth')}}
          >
            Mouth
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "skinTone") "active"}}'
            data-category='skinTone'
            {{on 'click' (fn this.selectCategory 'skinTone')}}
          >
            Skin
          </button>
          <button
            class='category-btn
              {{if (eq this.selectedCategory "clothes") "active"}}'
            data-category='clothes'
            {{on 'click' (fn this.selectCategory 'clothes')}}
          >
            Clothes
          </button>
        </div>

        <div class='styles-grid-container'>
          <h4>{{this.selectedCategory}} Options</h4>

          {{#if (gt this.currentCategoryOptions.length 0)}}
            <div class='styles-grid'>
              {{#each this.currentCategoryOptions as |option|}}
                <button
                  type='button'
                  class='style-option avataaars-option
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

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Mono:wght@400;700&family=Fredoka+One:wght@400&family=Press+Start+2P:wght@400&display=swap');

      .avatar-creator {
        display: grid;
        grid-template-columns: 420px 1fr;
        gap: 2rem;
        padding: 2rem;
        min-height: 100vh;
        background: #2c3e50;
        font-family: 'Inter', sans-serif;
        position: relative;
        overflow: hidden;
      }

      .avatar-creator::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-image:
    /* Racing track lines */
          linear-gradient(
            90deg,
            transparent 48%,
            rgba(255, 255, 255, 0.1) 49%,
            rgba(255, 255, 255, 0.1) 51%,
            transparent 52%
          ),
          linear-gradient(
            0deg,
            transparent 48%,
            rgba(255, 255, 255, 0.08) 49%,
            rgba(255, 255, 255, 0.08) 51%,
            transparent 52%
          );
        background-size:
          60px 60px,
          60px 60px;
        pointer-events: none;
        z-index: 0;
        animation: trackMove 8s linear infinite;
      }

      @keyframes trackMove {
        0% {
          transform: translateX(0) translateY(0);
        }
        100% {
          transform: translateX(60px) translateY(60px);
        }
      }

      .avatar-display {
        background: rgba(52, 73, 94, 0.8);
        border: 4px solid #ffffff;
        border-radius: 2px;
        padding: 2rem;
        backdrop-filter: blur(15px);
        box-shadow:
          0 0 30px rgba(255, 107, 107, 0.3),
          0 20px 40px rgba(0, 0, 0, 0.3),
          inset 0 2px 0 rgba(255, 255, 255, 0.3);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 1.5rem;
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

      .avatar-preview {
        width: 280px;
        height: 280px;
        border: 6px solid #ffffff;
        border-radius: 50%;
        overflow: hidden;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: linear-gradient(
          135deg,
          #3498db 0%,
          #9b59b6 50%,
          #e74c3c 100%
        );
        background-size: 200% 200%;
        animation: marioKartRainbow 6s ease infinite;
        box-shadow:
          0 0 40px rgba(52, 152, 219, 0.4),
          0 0 80px rgba(155, 89, 182, 0.3),
          inset 0 6px 0 rgba(255, 255, 255, 0.4);
        transition: all 0.3s ease;
      }

      .avatar-preview:hover {
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

      .avatar-info h2 {
        margin: 0 0 1.5rem 0;
        color: #ffffff;
        font-size: 2rem;
        font-weight: 700;
        text-align: center;
        letter-spacing: -0.025em;
        font-family: 'Press Start 2P', cursive;
        text-shadow:
          3px 3px 0px #ff6b6b,
          6px 6px 0px #4ecdc4;
        background: linear-gradient(45deg, #ff6b6b, #4ecdc4, #45b7d1, #feca57);
        background-size: 300% 300%;
        -webkit-background-clip: text;
        -webkit-text-fill-color: transparent;
        background-clip: text;
        animation: textShimmer 3s ease-in-out infinite;
        word-wrap: break-word;
        overflow-wrap: break-word;
        hyphens: auto;
      }

      /* URL Copy Section Styles */
      .url-copy-section {
        margin-bottom: 1.5rem;
        padding: 1rem;
        background: rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        backdrop-filter: blur(10px);
      }

      .url-display-row {
        display: flex;
        gap: 0.5rem;
        align-items: center;
        min-width: 0;
      }

      .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
      }

      .url-input {
        flex: 1;
        padding: 0.75rem 1rem;
        background: rgba(0, 0, 0, 0.3);
        border: 2px solid rgba(255, 255, 255, 0.2);
        border-radius: 6px;
        color: #ffffff;
        font-size: 0.875rem;
        font-family: 'Space Mono', monospace;
        outline: none;
        transition: all 0.3s ease;
      }

      .url-input:focus {
        border-color: #4ecdc4;
        box-shadow: 0 0 0 2px rgba(78, 205, 196, 0.2);
      }

      .copy-btn {
        padding: 0.75rem;
        background: linear-gradient(135deg, #4ecdc4 0%, #45b7d1 100%);
        border: 2px solid #4ecdc4;
        border-radius: 6px;
        color: #ffffff;
        cursor: pointer;
        transition: all 0.3s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 48px;
        height: 48px;
        font-size: 1rem;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(78, 205, 196, 0.3);
      }

      .copy-btn:hover {
        transform: translateY(-2px) scale(1.05);
        box-shadow: 0 6px 20px rgba(78, 205, 196, 0.4);
        background: linear-gradient(135deg, #26a69a 0%, #42a5f5 100%);
      }

      .copy-btn.copied {
        background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);
        border-color: #27ae60;
        transform: scale(1.1);
      }

      .copy-icon {
        width: 18px;
        height: 18px;
      }

      .copy-feedback {
        margin-top: 0.75rem;
        padding: 0.5rem;
        background: rgba(39, 174, 96, 0.2);
        border: 1px solid rgba(39, 174, 96, 0.4);
        border-radius: 4px;
        color: #2ecc71;
        font-size: 0.8125rem;
        text-align: center;
        font-weight: 600;
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
        background: rgba(52, 73, 94, 0.6);
        padding: 1.25rem;
        border-radius: 2px;
        border: 2px solid rgba(255, 255, 255, 0.2);
        box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.1);
      }

      .detail-item {
        font-size: 0.875rem;
        color: #ffffff;
        background: rgba(255, 255, 255, 0.1);
        padding: 0.75rem;
        border-radius: 2px;
        border-left: 4px solid #ff6b6b;
        font-weight: 600;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
        transition: all 0.2s ease;
        position: relative;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
      }

      .detail-item::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.2),
          transparent
        );
        transition: left 0.5s ease;
      }

      .detail-item:hover::before {
        left: 100%;
      }

      .detail-item:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .detail-item strong {
        color: #ff6b6b;
        text-transform: uppercase;
        font-size: 0.75rem;
        letter-spacing: 0.5px;
        font-weight: 700;
        display: block;
        margin-bottom: 0.25rem;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .customization-panel {
        background: rgba(44, 62, 80, 0.9);
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-radius: 2px;
        padding: 2rem;
        backdrop-filter: blur(15px);
        box-shadow:
          0 20px 40px rgba(0, 0, 0, 0.2),
          inset 0 1px 0 rgba(255, 255, 255, 0.3);
        height: 100%;
        position: relative;
        z-index: 1;
      }

      .panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 2rem;
        padding-bottom: 1rem;
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .header-buttons {
        display: flex;
        gap: 1rem;
        align-items: center;
      }

      .customization-panel h3 {
        margin: 0;
        color: #ffffff;
        font-size: 1.25rem;
        font-weight: 600;
        letter-spacing: -0.025em;
      }

      .category-nav {
        display: flex;
        justify-content: flex-start;
        gap: 0.5rem;
        margin-bottom: 2rem;
        flex-wrap: wrap;
      }

      .category-btn {
        padding: 0.75rem 1rem;
        border: 3px solid transparent;
        border-radius: 2px;
        background: rgba(255, 255, 255, 0.1);
        color: rgba(255, 255, 255, 0.9);
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        font-size: 0.875rem;
        font-weight: 700;
        font-family: 'Press Start 2P', cursive;
        backdrop-filter: blur(15px);
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        position: relative;
        overflow: hidden;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        box-shadow:
          0 4px 15px rgba(0, 0, 0, 0.2),
          inset 0 2px 0 rgba(255, 255, 255, 0.2);
      }

      /* Power-Up specific colors */
      .category-btn[data-category='hair'] {
        background: linear-gradient(
          135deg,
          #ff6b35 0%,
          #f7931e 50%,
          #ffd23f 100%
        );
        border-color: #ff6b35;
        box-shadow:
          0 0 20px rgba(255, 107, 53, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='hairColor'] {
        background: linear-gradient(
          135deg,
          #e74c3c 0%,
          #8e44ad 50%,
          #3498db 100%
        );
        border-color: #e74c3c;
        box-shadow:
          0 0 20px rgba(231, 76, 60, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='eyes'] {
        background: linear-gradient(
          135deg,
          #1abc9c 0%,
          #16a085 50%,
          #27ae60 100%
        );
        border-color: #1abc9c;
        box-shadow:
          0 0 20px rgba(26, 188, 156, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='eyebrows'] {
        background: linear-gradient(
          135deg,
          #f39c12 0%,
          #e67e22 50%,
          #d35400 100%
        );
        border-color: #f39c12;
        box-shadow:
          0 0 20px rgba(243, 156, 18, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='mouth'] {
        background: linear-gradient(
          135deg,
          #e91e63 0%,
          #ad1457 50%,
          #c2185b 100%
        );
        border-color: #e91e63;
        box-shadow:
          0 0 20px rgba(233, 30, 99, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='skinTone'] {
        background: linear-gradient(
          135deg,
          #ffab91 0%,
          #ffcc02 50%,
          #ff8a65 100%
        );
        border-color: #ffab91;
        box-shadow:
          0 0 20px rgba(255, 171, 145, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn[data-category='clothes'] {
        background: linear-gradient(
          135deg,
          #9c27b0 0%,
          #673ab7 50%,
          #3f51b5 100%
        );
        border-color: #9c27b0;
        box-shadow:
          0 0 20px rgba(156, 39, 176, 0.6),
          0 4px 15px rgba(0, 0, 0, 0.3);
      }

      .category-btn:hover {
        transform: translateY(-2px) scale(1.01);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .category-btn.active {
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .styles-grid-container {
        min-height: 300px;
        background: rgba(255, 255, 255, 0.02);
        padding: 1.5rem;
        border-radius: 2px;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }

      .styles-grid-container h4 {
        margin: 0 0 1.5rem 0;
        color: #ffffff;
        font-size: 1rem;
        font-weight: 600;
        text-transform: capitalize;
        letter-spacing: -0.025em;
      }

      .styles-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
        gap: 1rem;
        padding: 0;
      }

      .style-option {
        border: 3px solid transparent;
        border-radius: 2px;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        overflow: hidden;
        background: rgba(255, 255, 255, 0.1);
        aspect-ratio: 1;
        display: flex;
        flex-direction: column;
        position: relative;
        backdrop-filter: blur(15px);
        box-shadow:
          0 6px 20px rgba(0, 0, 0, 0.15),
          inset 0 2px 0 rgba(255, 255, 255, 0.2);
        padding: 0;
        width: 100%;
        height: 100%;
      }

      .style-option:hover {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.2);
        transform: translateY(-2px) scale(1.02);
        box-shadow: 0 4px 12px rgba(255, 215, 0, 0.3);
      }

      .style-option.selected {
        border-color: #ffd700;
        background: rgba(255, 215, 0, 0.2);
        transform: translateY(-1px) scale(1.02);
        box-shadow: 0 2px 8px rgba(255, 215, 0, 0.4);
      }

      .style-option.selected::after {
        content: '⭐';
        position: absolute;
        top: -10px;
        right: -10px;
        background: linear-gradient(45deg, #ffd700, #ffa500);
        border-radius: 50%;
        width: 24px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        animation: marioKartStar 1s ease-in-out infinite;
        box-shadow: 0 0 15px rgba(255, 215, 0, 0.8);
      }

      @keyframes marioKartStar {
        0%,
        100% {
          transform: rotate(0deg) scale(1);
        }
        50% {
          transform: rotate(180deg) scale(1.2);
        }
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
        width: 52px;
        height: 52px;
        border-radius: 50%;
        overflow: hidden;
        border: 3px solid rgba(255, 255, 255, 0.3);
        background: rgba(255, 215, 0, 0.1);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.3s ease;
        flex-shrink: 0;
        position: relative;
      }

      .style-option:hover .option-image {
        transform: scale(1.1) rotateZ(5deg);
        border-color: rgba(255, 215, 0, 0.6);
      }

      .style-option.selected .option-image {
        border-color: rgba(255, 215, 0, 0.8);
        transform: scale(1.05);
      }

      .preview-avatar {
        width: 100%;
        height: 100%;
        object-fit: cover;
        border-radius: 50%;
        filter: brightness(1.1) contrast(1.05);
      }

      .option-label {
        font-size: 0.75rem;
        color: rgba(255, 255, 255, 0.8);
        font-weight: 500;
        font-family: 'Inter', sans-serif;
        line-height: 1.3;
        max-width: 100%;
        text-transform: capitalize;
        transition: color 0.3s ease;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding: 0 0.25rem;
      }

      /* Fixed: Remove blue hover color, keep white/gold theme */
      .style-option:hover .option-label {
        color: #ffd700;
        font-weight: 600;
      }

      .style-option.selected .option-label {
        color: #ffd700;
        font-weight: 600;
        text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
      }

      .random-btn {
        padding: 1rem 1.5rem;
        border: 3px solid #ff6b6b;
        border-radius: 2px;
        background: linear-gradient(
          135deg,
          #ff6b6b 0%,
          #4ecdc4 25%,
          #45b7d1 50%,
          #96ceb4 75%,
          #ffeaa7 100%
        );
        background-size: 300% 300%;
        color: #ffffff;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        font-size: 1rem;
        font-weight: 700;
        font-family: 'Press Start 2P', cursive;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        backdrop-filter: blur(15px);
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        box-shadow:
          0 6px 20px rgba(255, 107, 107, 0.4),
          inset 0 2px 0 rgba(255, 255, 255, 0.3);
        position: relative;
        overflow: hidden;
        animation: marioKartMushroom 4s ease-in-out infinite;
      }

      @keyframes marioKartMushroom {
        0%,
        100% {
          background-position: 0% 50%;
          transform: scale(1);
        }
        25% {
          background-position: 100% 0%;
          transform: scale(1.02);
        }
        50% {
          background-position: 100% 100%;
          transform: scale(1);
        }
        75% {
          background-position: 0% 100%;
          transform: scale(1.02);
        }
      }

      .random-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.4),
          transparent
        );
        transition: left 0.6s ease;
      }

      .random-btn:hover::before {
        left: 100%;
      }

      .random-btn:hover {
        background: linear-gradient(
          135deg,
          #ff5252 0%,
          #26a69a 25%,
          #42a5f5 50%,
          #66bb6a 75%,
          #ffca28 100%
        );
        transform: translateY(-4px) scale(1.08);
        box-shadow:
          0 12px 35px rgba(255, 107, 107, 0.6),
          0 0 40px rgba(78, 205, 196, 0.4);
        border-color: #ff5252;
      }

      .random-btn:active {
        transform: translateY(-2px) scale(1.05);
      }

      .empty-styles {
        display: flex;
        justify-content: center;
        align-items: center;
        height: 200px;
        color: rgba(255, 255, 255, 0.6);
        font-size: 0.875rem;
        text-align: center;
        font-style: italic;
      }

      /* Responsive Design */
      @media (max-width: 1200px) {
        .avatar-creator {
          grid-template-columns: 400px 1fr;
          gap: 1.5rem;
          padding: 1.5rem;
        }

        .avatar-preview {
          width: 260px;
          height: 260px;
        }
      }

      @media (max-width: 720px) {
        .avatar-creator {
          padding: 0.75rem;
          gap: 0.75rem;
          grid-template-columns: 1fr;
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

      .ai-suggestion-btn {
        padding: 1rem 1.5rem;
        border: 3px solid #4ecdc4;
        border-radius: 2px;
        background: linear-gradient(
          135deg,
          #4ecdc4 0%,
          #45b7d1 25%,
          #9b59b6 50%,
          #e74c3c 75%,
          #f39c12 100%
        );
        background-size: 300% 300%;
        color: #ffffff;
        cursor: pointer;
        transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        font-size: 1rem;
        font-weight: 700;
        font-family: 'Press Start 2P', cursive;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        backdrop-filter: blur(15px);
        text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
        box-shadow:
          0 6px 20px rgba(78, 205, 196, 0.4),
          inset 0 2px 0 rgba(255, 255, 255, 0.3);
        position: relative;
        overflow: hidden;
        animation: aiSuggestionPulse 3s ease-in-out infinite;
      }

      .ai-suggestion-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        animation: none;
      }

      @keyframes aiSuggestionPulse {
        0%,
        100% {
          background-position: 0% 50%;
          transform: scale(1);
        }
        25% {
          background-position: 100% 0%;
          transform: scale(1.01);
        }
        50% {
          background-position: 100% 100%;
          transform: scale(1);
        }
        75% {
          background-position: 0% 100%;
          transform: scale(1.01);
        }
      }

      .ai-suggestion-btn::before {
        content: '';
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent,
          rgba(255, 255, 255, 0.4),
          transparent
        );
        transition: left 0.6s ease;
      }

      .ai-suggestion-btn:hover:not(:disabled)::before {
        left: 100%;
      }

      .ai-suggestion-btn:hover:not(:disabled) {
        background: linear-gradient(
          135deg,
          #26a69a 0%,
          #42a5f5 25%,
          #8e44ad 50%,
          #c0392b 75%,
          #e67e22 100%
        );
        transform: translateY(-4px) scale(1.08);
        box-shadow:
          0 12px 35px rgba(78, 205, 196, 0.6),
          0 0 40px rgba(155, 89, 182, 0.4);
        border-color: #26a69a;
      }

      .ai-suggestion-btn:active:not(:disabled) {
        transform: translateY(-2px) scale(1.05);
      }
    </style>
  </template>
}

export const getAvataarsUrl = (model: AvataaarsModel) => {
  let {
    topType,
    accessoriesType,
    hairColor,
    facialHairType,
    clotheType,
    eyeType,
    eyebrowType,
    mouthType,
    skinColor,
  } = model;
  const params = [
    `topType=${encodeURIComponent(topType || 'ShortHairShortFlat')}`,
    `accessoriesType=${encodeURIComponent(accessoriesType || 'Blank')}`,
    `hairColor=${encodeURIComponent(hairColor || 'BrownDark')}`,
    `facialHairType=${encodeURIComponent(facialHairType || 'Blank')}`,
    `clotheType=${encodeURIComponent(clotheType || 'BlazerShirt')}`,
    `eyeType=${encodeURIComponent(eyeType || 'Default')}`,
    `eyebrowType=${encodeURIComponent(eyebrowType || 'Default')}`,
    `mouthType=${encodeURIComponent(mouthType || 'Default')}`,
    `skinColor=${encodeURIComponent(skinColor || 'Light')}`,
  ];
  return `https://avataaars.io/?${params.join('&')}`;
};
