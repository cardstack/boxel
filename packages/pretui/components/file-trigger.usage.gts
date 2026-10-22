// Pretui — FileTrigger usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { Chip } from './chip';
import { FileTrigger } from './file-trigger';
import { FreestyleUsage } from './freestyle-usage';
import { TakenFile, record } from '../internal/file-intake-fixtures';

// ── FileTrigger ─────────────────────────────────────────────────────────
class FileTriggerUsage extends Component {
  @tracked label = 'Choose lot photographs';
  @tracked accept = 'image/*';
  @tracked multiple = true;
  @tracked disabled = false;
  @tracked taken: TakenFile[] = [];

  setLabel = (v: string) => (this.label = v);
  setAccept = (v: string) => (this.accept = v);
  setMultiple = (v: boolean) => (this.multiple = v);
  setDisabled = (v: boolean) => (this.disabled = v);
  onSelect = (files: File[]) => (this.taken = record(files));

  get usage(): string {
    let bits = ["@label='" + this.label + "'"];
    if (this.accept) bits.push("@accept='" + this.accept + "'");
    if (this.multiple) bits.push('@multiple={{true}}');
    if (this.disabled) bits.push('@disabled={{true}}');
    bits.push('@onSelect={{this.take}}');
    return '<FileTrigger ' + bits.join(' ') + ' />';
  }

  <template>
    <FreestyleUsage
      @name='FileTrigger'
      @description='A button that opens the platform file picker with the input type=file encapsulated, so no caller ever hides one themselves. The button is a SLOT, not a set of strings: supply a default block to replace it entirely and wire whatever control you like to the yielded open function.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-files-demo'>
          <FileTrigger
            @label={{this.label}}
            @accept={{this.accept}}
            @multiple={{this.multiple}}
            @disabled={{this.disabled}}
            @onSelect={{this.onSelect}}
          />
          {{#if this.taken}}
            <ul class='pretui-files-demo-list'>
              {{#each this.taken key='name' as |item|}}
                <li><Chip>{{item.name}}</Chip></li>
              {{/each}}
            </ul>
          {{else}}
            <p class='pretui-files-demo-empty'>Nothing chosen yet.</p>
          {{/if}}
        </div>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value={{this.label}}
          @defaultValue='Choose files'
          @description='The button text, and the accessible name of the encapsulated input.'
          @onInput={{this.setLabel}}
        />
        <Args.String
          @name='accept'
          @value={{this.accept}}
          @description='An input accept list. Filters the picker, and — inside a Dropzone — the drop path too.'
          @onInput={{this.setAccept}}
        />
        <Args.Bool
          @name='multiple'
          @value={{this.multiple}}
          @defaultValue={{false}}
          @description='Allow selecting more than one file.'
          @onInput={{this.setMultiple}}
        />
        <Args.Bool
          @name='disabled'
          @value={{this.disabled}}
          @defaultValue={{false}}
          @description='Dimmed and inert.'
          @onInput={{this.setDisabled}}
        />
        <Args.Action
          @name='onSelect'
          @description='Receives the chosen File objects. Never called with an empty list, and the input is reset afterwards so choosing the same file twice still fires.'
        />
        <Args.Yield
          @name='default'
          @description='Replaces the button. Receives an api with open() and disabled.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-files-demo {
        display: grid;
        gap: var(--space-3, 8px);
        justify-items: start;
      }
      .pretui-files-demo-list {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-wrap: wrap;
        gap: var(--space-2, 6px);
      }
      .pretui-files-demo-empty {
        margin: 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_FILE_TRIGGER: Record<string, unknown> = {
  FileTrigger: FileTriggerUsage,
};
