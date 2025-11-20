import Component from '@glimmer/component';

interface Signature {
  Args: {
    percentage: number;
    showPercentage?: boolean;
    showSizeInfo?: boolean;
    uploadedBytes?: number;
    totalBytes?: number;
  };
}

export default class UploadProgress extends Component<Signature> {
  get formattedSize(): string {
    if (!this.args.uploadedBytes || !this.args.totalBytes) return '';

    const uploaded = this.formatBytes(this.args.uploadedBytes);
    const total = this.formatBytes(this.args.totalBytes);
    return `${uploaded} / ${total}`;
  }

  get uploadSpeed(): string {
    // Estimate upload speed based on progress
    if (!this.args.uploadedBytes || this.args.percentage === 0) return '';

    // Simple estimation (could be enhanced with real timing)
    const mbUploaded = this.args.uploadedBytes / (1024 * 1024);
    const estimatedSeconds = (this.args.percentage / 100) * 10; // Assuming ~10s total
    const mbPerSecond = mbUploaded / estimatedSeconds;

    if (mbPerSecond < 1) {
      return `${(mbPerSecond * 1024).toFixed(0)} KB/s`;
    }
    return `${mbPerSecond.toFixed(1)} MB/s`;
  }

  get remainingTime(): string {
    if (this.args.percentage >= 95) return 'Almost done...';
    if (this.args.percentage >= 75) return 'A few seconds left';
    if (this.args.percentage >= 50) return 'About 30 seconds';
    if (this.args.percentage >= 25) return 'About 1 minute';
    return 'Calculating...';
  }

  get progressStatus(): string {
    if (this.args.percentage === 100) return 'complete';
    if (this.args.percentage >= 75) return 'high';
    if (this.args.percentage >= 25) return 'medium';
    return 'low';
  }

  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  <template>
    <div
      class='upload-progress progress-{{this.progressStatus}}'
      data-test-upload-progress
    >
      <div class='progress-header'>
        <span class='progress-label'>Uploading...</span>
        {{#if @showPercentage}}
          <span class='progress-percentage' data-test-progress-percentage>
            {{@percentage}}%
          </span>
        {{/if}}
      </div>

      <div class='progress-bar-container'>
        <div
          class='progress-bar-fill'
          style='width: {{@percentage}}%'
          data-test-progress-bar
        >
          <div class='progress-shine'></div>
        </div>
      </div>

      {{#if @showSizeInfo}}
        <div class='progress-footer'>
          <span class='progress-size' data-test-progress-size>
            {{this.formattedSize}}
          </span>
          <span class='progress-status'>
            {{this.remainingTime}}
          </span>
        </div>
      {{/if}}
    </div>

    <style scoped>
      .upload-progress {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: calc(var(--spacing, 0.25rem) * 1.5);
        padding: calc(var(--spacing, 0.25rem) * 2);
        background: var(--muted, #f9fafb);
        border-radius: var(--radius, 0.375rem);
        border: 1px solid var(--border, #e5e7eb);
        transition: all 0.3s ease;
      }

      .progress-low {
        border-color: var(--muted, #e5e7eb);
      }

      .progress-medium {
        border-color: var(--primary, #3b82f6);
        background: linear-gradient(to right, #eff6ff 0%, #f9fafb 100%);
      }

      .progress-high {
        border-color: var(--primary, #3b82f6);
        background: linear-gradient(to right, #dbeafe 0%, #eff6ff 100%);
      }

      .progress-complete {
        border-color: #10b981;
        background: linear-gradient(to right, #d1fae5 0%, #ecfdf5 100%);
      }

      .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }

      .progress-label {
        font-size: 0.75rem;
        font-weight: 500;
        color: var(--muted-foreground, #6b7280);
      }

      .progress-percentage {
        font-size: 0.875rem;
        font-weight: 700;
        color: var(--primary, #3b82f6);
        font-family: var(--font-mono, monospace);
      }

      .progress-complete .progress-percentage {
        color: #10b981;
      }

      .progress-bar-container {
        position: relative;
        width: 100%;
        height: 0.5rem;
        background: white;
        border-radius: var(--radius, 9999px);
        overflow: hidden;
        box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.08);
      }

      .progress-bar-fill {
        position: relative;
        height: 100%;
        background: linear-gradient(
          90deg,
          var(--primary, #3b82f6) 0%,
          var(--accent, #60a5fa) 50%,
          var(--primary, #3b82f6) 100%
        );
        border-radius: var(--radius, 9999px);
        transition: width 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        overflow: hidden;
      }

      .progress-complete .progress-bar-fill {
        background: linear-gradient(
          90deg,
          #10b981 0%,
          #34d399 50%,
          #10b981 100%
        );
      }

      .progress-shine {
        position: absolute;
        top: 0;
        left: -100%;
        width: 100%;
        height: 100%;
        background: linear-gradient(
          90deg,
          transparent 0%,
          rgba(255, 255, 255, 0.4) 50%,
          transparent 100%
        );
        animation: shine 2s infinite;
      }

      @keyframes shine {
        0% {
          left: -100%;
        }
        100% {
          left: 200%;
        }
      }

      .progress-footer {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 0.6875rem;
      }

      .progress-size {
        font-family: var(--font-mono, monospace);
        color: var(--muted-foreground, #6b7280);
        font-weight: 400;
      }

      .progress-status {
        color: var(--muted-foreground, #6b7280);
        font-style: italic;
        font-size: 0.6875rem;
      }

      .progress-complete .progress-status {
        color: #10b981;
        font-weight: 600;
        font-style: normal;
      }
    </style>
  </template>
}
