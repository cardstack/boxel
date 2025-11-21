// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Component } from 'https://cardstack.com/base/card-api'; // ¹ Core imports
import Loader2Icon from '@cardstack/boxel-icons/loader-2'; // ² Icon import

// ³ Component signature interface
interface UploadProgressSignature {
  Args: {
    progress: number;
  };
}

// ⁴ Upload progress component
export class UploadProgress extends Component<UploadProgressSignature> {
  <template>
    <div class='upload-progress'>
      {{! ⁵ Progress display }}
      <div class='progress-header'>
        <Loader2Icon class='spinner' />
        <span class='progress-text'>Uploading...</span>
        <span class='progress-percent'>{{@progress}}%</span>
      </div>
      <div class='progress-bar-container'>
        <div class='progress-bar' style='width: {{@progress}}%'></div>
      </div>
    </div>

    <style
      scoped
    > {{! ⁶ Component styles }}
      .upload-progress {
        border: 2px solid var(--border, #e0e0e0);
        border-radius: var(--radius, 0.5rem);
        padding: 2rem;
        background: var(--input, #ffffff);
      }

      .progress-header {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-bottom: 0.75rem;
      }

      .spinner {
        width: 1.5rem;
        height: 1.5rem;
        color: var(--primary, #3b82f6);
        animation: spin 1s linear infinite;
      }

      @keyframes spin {
        from {
          transform: rotate(0deg);
        }
        to {
          transform: rotate(360deg);
        }
      }

      .progress-text {
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--foreground, #1a1a1a);
        flex: 1;
      }

      .progress-percent {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--primary, #3b82f6);
      }

      .progress-bar-container {
        width: 100%;
        height: 0.75rem;
        background: var(--muted, #f1f5f9);
        border-radius: 9999px;
        overflow: hidden;
      }

      .progress-bar {
        height: 100%;
        background: linear-gradient(to right, var(--primary, #3b82f6), #60a5fa);
        border-radius: 9999px;
        transition: width 0.3s ease;
      }
    </style>
  </template>
}
