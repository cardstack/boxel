// Pretui — Dropzone usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { FileRejection } from '../internal/file-intake';
import { Chip } from './chip';
import { Dropzone } from './dropzone';
import { FreestyleUsage } from './freestyle-usage';
import { TakenFile, record } from '../internal/file-intake-fixtures';

// ── Dropzone ────────────────────────────────────────────────────────────
class DropzoneUsage extends Component {
  @tracked label = 'Drop lot photographs here';
  @tracked hint = 'JPEG or PNG, up to 2 MB each, three at a time';
  @tracked accept = 'image/png, image/jpeg';
  @tracked multiple = true;
  @tracked maxFiles = 3;
  @tracked maxSize = 2097152;
  @tracked disabled = false;
  @tracked taken: TakenFile[] = [];
  @tracked refused: FileRejection[] = [];

  setLabel = (v: string) => (this.label = v);
  setHint = (v: string) => (this.hint = v);
  setAccept = (v: string) => (this.accept = v);
  setMultiple = (v: boolean) => (this.multiple = v);
  setMaxFiles = (v: number | null) => (this.maxFiles = v ?? 3);
  setMaxSize = (v: number | null) => (this.maxSize = v ?? 2097152);
  setDisabled = (v: boolean) => (this.disabled = v);
  onSelect = (files: File[]) => (this.taken = record(files));
  onReject = (list: FileRejection[]) => (this.refused = list);

  get usage(): string {
    let bits = [
      "@label='" + this.label + "'",
      "@accept='" + this.accept + "'",
      '@maxFiles={{' + this.maxFiles + '}}',
      '@maxSize={{' + this.maxSize + '}}',
    ];
    if (this.multiple) bits.push('@multiple={{true}}');
    bits.push('@onSelect={{this.take}}');
    bits.push('@onReject={{this.refuse}}');
    return '<Dropzone ' + bits.join(' ') + ' />';
  }

  <template>
    <FreestyleUsage
      @name='Dropzone'
      @description='A drop target that contains its own browse button — drag is the enhancement, never the only path. Files are screened against accept, maxSize and maxFiles on BOTH paths (a drop does not honour the accept attribute on its own), and every acceptance and refusal, with its reason, is announced in a polite live region. Try dropping a PDF, or four images at once.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-dz-demo'>
          <Dropzone
            @label={{this.label}}
            @hint={{this.hint}}
            @accept={{this.accept}}
            @multiple={{this.multiple}}
            @maxFiles={{this.maxFiles}}
            @maxSize={{this.maxSize}}
            @disabled={{this.disabled}}
            @onSelect={{this.onSelect}}
            @onReject={{this.onReject}}
          />
          <div class='pretui-dz-demo-out'>
            <div>
              <p class='pretui-dz-demo-head'>Accepted</p>
              {{#if this.taken}}
                <ul class='pretui-dz-demo-list'>
                  {{#each this.taken key='name' as |item|}}
                    <li><Chip>{{item.name}}</Chip></li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='pretui-dz-demo-empty'>None yet.</p>
              {{/if}}
            </div>
            <div>
              <p class='pretui-dz-demo-head'>Refused</p>
              {{#if this.refused}}
                <ul class='pretui-dz-demo-list'>
                  {{#each this.refused key='name' as |item|}}
                    <li><Chip>{{item.name}} — {{item.detail}}</Chip></li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='pretui-dz-demo-empty'>None yet.</p>
              {{/if}}
            </div>
          </div>
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Drop files here'
          @description='The headline inside the zone.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='hint'
          @value={{this.hint}}
          @description='The second line. Say what is allowed, in words, here — the screening rules are invisible otherwise.'
          @onInput={{this.setHint}}
        />
        <Args.String
          @name='accept'
          @value={{this.accept}}
          @description='An input accept list. Extension tokens matter: browsers report an empty MIME type for plenty of real files.'
          @onInput={{this.setAccept}}
        />
        <Args.Bool
          @name='multiple'
          @value={{this.multiple}}
          @defaultValue={{false}}
          @description='Allow more than one file per batch. False caps the batch at one whatever maxFiles says.'
          @onInput={{this.setMultiple}}
        />
        <Args.Number
          @name='maxFiles'
          @value={{this.maxFiles}}
          @min={{1}}
          @max={{8}}
          @step={{1}}
          @description='How many files one batch may contribute. The cap is applied only to files that already passed the other rules, so oversized files do not consume the slots.'
          @onInput={{this.setMaxFiles}}
        />
        <Args.Number
          @name='maxSize'
          @value={{this.maxSize}}
          @min={{1024}}
          @max={{8388608}}
          @step={{262144}}
          @description='Largest single file, in bytes.'
          @onInput={{this.setMaxSize}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Dimmed and inert; drops are ignored.'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onSelect'
          @description='Everything that passed screening.'
        />
        <Args.Action
          @name='onReject'
          @description='Everything that did not, each with a reason code and human copy.'
        />
      </:api>
      <:cssVars as |Css|>
        <Css.Basic
          @name='pretui-dropzone-glyph-size'
          @type='dimension'
          @description='The size of the zone glyph.'
        />
        <Css.Basic
          @name='pretui-dropzone-transition'
          @type='duration'
          @description='How long the drop ring takes to light up.'
        />
      </:cssVars>
    </FreestyleUsage>
    <style scoped>
      .pretui-dz-demo {
        display: grid;
        gap: var(--space-4, 11px);
      }
      .pretui-dz-demo-out {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: var(--space-4, 11px);
      }
      .pretui-dz-demo-head {
        margin: 0 0 4px;
        font-family: var(--font-mono);
        font-size: var(--text-ui-xs, 11px);
        letter-spacing: var(--track-eyebrow, 0.08em);
        text-transform: uppercase;
        color: var(--muted-foreground);
      }
      .pretui-dz-demo-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
      }
      .pretui-dz-demo-empty {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_DROPZONE: Record<string, unknown> = {
  Dropzone: DropzoneUsage,
};
