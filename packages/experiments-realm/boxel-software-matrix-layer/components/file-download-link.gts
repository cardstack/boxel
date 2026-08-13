import Component from '@glimmer/component';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import DownloadIcon from '@cardstack/boxel-icons/download';
import type { FileDef } from '@cardstack/base/file-api';

// A resume/cover-letter/attachment row that actually looks and behaves like
// a downloadable file, instead of delegating to FileDef's own atom format
// (a bare icon + name with no visible download affordance — see the "Cover
// letter" panel this replaced, which read as inert text). Two consumers:
// Application's resumeFile/coverLetterFile and Candidate's resumeFile.
interface Signature {
  Args: {
    file: FileDef | undefined | null;
    label?: string;
  };
  Element: HTMLAnchorElement;
}

export default class FileDownloadLink extends Component<Signature> {
  <template>
    {{#if @file.url}}
      <a
        class='file-download-link'
        href={{@file.url}}
        download={{@file.name}}
        target='_blank'
        rel='noopener noreferrer'
      >
        <FileTextIcon class='fdl-icon' aria-hidden='true' />
        <span class='fdl-name'>{{if @label @label @file.name}}</span>
        <DownloadIcon class='fdl-download' aria-hidden='true' />
      </a>
    {{/if}}
    <style scoped>
      .file-download-link {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        border: 1px solid var(--border, var(--boxel-200));
        border-radius: var(--boxel-border-radius-sm);
        background: var(--card, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
        font-size: var(--boxel-font-size-sm);
        font-weight: 600;
        text-decoration: none;
        max-width: 100%;
        transition:
          border-color 0.15s ease-out,
          background 0.15s ease-out;
      }
      .file-download-link:hover,
      .file-download-link:focus-visible {
        border-color: var(--primary, var(--boxel-highlight));
        background: color-mix(
          in oklch,
          var(--primary, var(--boxel-highlight)) 8%,
          var(--card, var(--boxel-light))
        );
      }
      .file-download-link:focus-visible {
        outline: 2px solid var(--ring, var(--boxel-highlight));
        outline-offset: 2px;
      }
      .fdl-icon {
        flex: none;
        width: 1rem;
        height: 1rem;
        color: var(--muted-foreground, var(--boxel-450));
      }
      .fdl-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .fdl-download {
        flex: none;
        width: 0.9375rem;
        height: 0.9375rem;
        margin-left: var(--boxel-sp-4xs);
        color: var(--muted-foreground, var(--boxel-450));
      }
    </style>
  </template>
}
