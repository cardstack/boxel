import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { Avatar } from '@cardstack/boxel-ui/components';
import { on } from '@ember/modifier';
import { Author } from '../author';
import EditIcon from '@cardstack/boxel-icons/edit';

interface ProfileEditArgs {
  Args: {
    author?: Author;
    fields?: Record<string, any>;
  };
  Element: HTMLDivElement;
}

export default class ProfileEditButton extends GlimmerComponent<ProfileEditArgs> {
  @tracked showEditDialog = false;

  get id() {
    return this.args.author?.id;
  }

  get displayName() {
    return this.args.author?.name ?? 'Anonymous';
  }

  @action
  toggleEditDialog() {
    this.showEditDialog = !this.showEditDialog;
  }

  @action
  closeEditDialog() {
    this.showEditDialog = false;
  }

  <template>
    <div class='profile-display-group' ...attributes>
      <div class='profile-button-container'>
        <button
          type='button'
          {{on 'click' this.toggleEditDialog}}
          aria-label='Edit profile'
          data-test-edit-profile-button
          class='profile-button'
        >
          <Avatar
            @userId={{this.id}}
            @displayName={{this.displayName}}
            @isReady={{true}}
          />
        </button>
        {{#unless @author}}
          <EditIcon class='edit-icon' />
        {{/unless}}
      </div>

      <span class='profile-button-text'>{{this.displayName}}</span>
    </div>

    {{#if this.showEditDialog}}
      <div class='edit-dialog-backdrop' role='presentation'>
        <div
          class='edit-dialog'
          role='dialog'
          aria-modal='true'
          aria-labelledby='edit-profile-title'
        >
          <div class='dialog-header'>
            <h3 id='edit-profile-title'>Edit Profile</h3>
            <button
              class='close-button'
              type='button'
              {{on 'click' this.closeEditDialog}}
              aria-label='Close dialog'
            >
              <svg
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <line x1='18' y1='6' x2='6' y2='18'></line>
                <line x1='6' y1='6' x2='18' y2='18'></line>
              </svg>
            </button>
          </div>
          <div class='dialog-content'>
            {{#if @fields}}
              <@fields.author @format='edit' />
            {{else}}
              <p>No profile fields available</p>
            {{/if}}
          </div>
        </div>
      </div>
    {{/if}}

    <style scoped>
      .profile-display-group {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }

      .profile-button-container {
        position: relative;
        display: inline-block;
      }

      .profile-button {
        all: unset;
        cursor: pointer;
        display: block;
      }

      .profile-button:hover {
        transform: scale(1.05);
        filter: drop-shadow(0 0 5px rgba(0, 0, 0, 0.3));
      }

      .profile-button:active {
        transform: scale(0.95);
      }

      .edit-icon {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 16px;
        height: 16px;
        color: var(--boxel-600);
        background: var(--boxel-light);
        border-radius: 50%;
        padding: 2px;
        z-index: 1;
      }

      .edit-dialog-backdrop {
        all: unset;
        cursor: pointer;
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: var(--boxel-sp);
      }

      .edit-dialog {
        background: var(--boxel-light);
        border-radius: var(--boxel-border-radius);
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        max-width: 400px;
        width: 100%;
        max-height: 80vh;
        overflow: hidden;
        animation: dialogSlideIn 0.2s ease-out;
      }

      @keyframes dialogSlideIn {
        from {
          opacity: 0;
          transform: scale(0.9) translateY(-10px);
        }
        to {
          opacity: 1;
          transform: scale(1) translateY(0);
        }
      }

      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--boxel-sp);
        border-bottom: 1px solid var(--boxel-200);
        background: var(--boxel-50);
      }

      .dialog-header h3 {
        margin: 0;
        font: 600 var(--boxel-font-lg);
        color: var(--boxel-700);
      }

      .close-button {
        background: none;
        border: none;
        padding: var(--boxel-sp-xs);
        cursor: pointer;
        border-radius: var(--boxel-border-radius-sm);
        color: var(--boxel-500);
        transition:
          background-color 0.15s ease,
          color 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .close-button:hover {
        background: var(--boxel-200);
        color: var(--boxel-700);
      }

      .close-button svg {
        width: 16px;
        height: 16px;
      }

      .dialog-content {
        padding: var(--boxel-sp);
      }

      /* Mobile responsiveness */
      @media (max-width: 640px) {
        .edit-dialog {
          margin: var(--boxel-sp);
          max-width: none;
        }
      }
    </style>
  </template>
}
