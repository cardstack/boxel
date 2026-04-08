import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import FileCodeIcon from '@cardstack/boxel-icons/file-code';

export class FileContentField extends FieldDef {
  @field filename = contains(StringField);
  @field contents = contains(StringField);

  static atom = class Atom extends Component<typeof FileContentField> {
    get filename() {
      return this.args.model.filename ?? 'Untitled';
    }

    <template>
      <span class='file-atom'>
        <FileCodeIcon class='file-atom-icon' width='12' height='12' />
        <span class='file-atom-name'>{{this.filename}}</span>
      </span>
      <style scoped>
        .file-atom {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 2px 6px;
          background: var(--muted, #f6f8fa);
          border-radius: var(--boxel-border-radius-sm);
          max-width: 100%;
          overflow: hidden;
        }

        .file-atom-icon {
          flex-shrink: 0;
          color: var(--muted-foreground, #656d76);
        }

        .file-atom-name {
          font-size: var(--boxel-font-size-2xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof FileContentField> {
    get filename() {
      return this.args.model.filename ?? 'Untitled';
    }

    get preview() {
      const contents = this.args.model.contents ?? '';
      return contents.split('\n').slice(0, 6).join('\n');
    }

    get lineCount() {
      const contents = this.args.model.contents ?? '';
      return contents ? contents.split('\n').length : 0;
    }

    get isLineCountPlural() {
      return this.lineCount !== 1;
    }

    <template>
      <div class='file-embedded'>
        <div class='file-header'>
          <FileCodeIcon class='file-header-icon' width='14' height='14' />
          <span class='file-name'>{{this.filename}}</span>
          {{#if this.lineCount}}
            <span class='line-badge'>{{this.lineCount}}
              line{{#if this.isLineCountPlural}}s{{/if}}</span>
          {{/if}}
        </div>
        {{#if this.preview}}
          <pre class='file-preview'>{{this.preview}}</pre>
        {{/if}}
      </div>
      <style scoped>
        .file-embedded {
          display: flex;
          flex-direction: column;
          border: 1px solid var(--border, #d0d7de);
          border-radius: var(--boxel-border-radius);
          overflow: hidden;
          background: var(--card, #ffffff);
        }

        .file-header {
          display: flex;
          align-items: center;
          gap: var(--boxel-sp-4xs);
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          background: var(--muted, #f6f8fa);
          border-bottom: 1px solid var(--border, #d0d7de);
          min-width: 0;
        }

        .file-header-icon {
          flex-shrink: 0;
          color: var(--muted-foreground, #656d76);
        }

        .file-name {
          flex: 1;
          font-size: var(--boxel-font-size-xs);
          font-weight: 500;
          font-family: var(--boxel-monospace-font-family);
          color: var(--foreground, #1f2328);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          min-width: 0;
        }

        .line-badge {
          flex-shrink: 0;
          font-size: var(--boxel-font-size-2xs);
          font-weight: 600;
          font-family: var(--boxel-font-family);
          letter-spacing: var(--boxel-lsp-sm);
          padding: 1px 5px;
          background: var(--muted, #f6f8fa);
          color: var(--muted-foreground, #656d76);
          border-radius: var(--boxel-border-radius-sm);
          white-space: nowrap;
        }

        .file-preview {
          margin: 0;
          padding: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-2xs);
          font-weight: 400;
          font-family: var(--boxel-monospace-font-family);
          line-height: 1.6;
          color: var(--muted-foreground, #656d76);
          white-space: pre;
          overflow: hidden;
          display: -webkit-box;
          -webkit-box-orient: vertical;
          -webkit-line-clamp: 6;
        }
      </style>
    </template>
  };
}

export class FileCollectionResult extends CardDef {
  static displayName = 'File Collection Result';
  @field allFileContents = containsMany(FileContentField);
}
