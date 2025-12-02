import GlimmerComponent from '@glimmer/component';
import { htmlSafe } from '@ember/template';
import Loader2Icon from '@cardstack/boxel-icons/loader-2';

interface UploadProgressArgs {
  Args: {
    progress: number;
  };
}

export default class UploadProgress extends GlimmerComponent<UploadProgressArgs> {
  get progressStyle() {
    return htmlSafe(`width: ${this.args.progress}%`);
  }

  <template>
    <div class='upload-progress'>
      {{! Progress display }}
      <div class='progress-header'>
        <Loader2Icon class='spinner' />
        <span class='progress-text'>Uploading...</span>
        <span class='progress-percent'>{{@progress}}%</span>
      </div>
      <div class='progress-bar-container'>
        <div class='progress-bar' style={{this.progressStyle}}></div>
      </div>
    </div>

    <style scoped>
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
        background: linear-gradient(to right, var(--primary, #3b82f6), var(--accent, #60a5fa));
        border-radius: 9999px;
        transition: width 0.3s ease;
      }
    </style>
  </template>
}
