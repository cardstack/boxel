// Pretui — EditInPlace usage page.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { EditInPlace } from './edit-in-place';
import { FreestyleUsage } from './freestyle-usage';
import { Select } from './select';
import type { SelectOption } from './select';

const ACTIVATIONS = ['button', 'row'];
const COMMIT_MODES = ['blur', 'action'];

// ── EditInPlace ──────────────────────────────────────────────────────────
// Dropped upstream surface: dblclick activation (no touch equivalent, no
// visible affordance) and the outside-click timer.
class EditInPlaceUsage extends Component {
  activations = ACTIVATIONS;
  commitModes = COMMIT_MODES;
  statuses: SelectOption[] = [
    { value: 'draft', label: 'Draft' },
    { value: 'review', label: 'In review' },
    { value: 'live', label: 'Published' },
  ];

  @tracked title = 'Quarterly revenue review';
  @tracked status = 'draft';
  @tracked activateOn = 'button';
  @tracked commitOn = 'blur';
  @tracked canEdit = true;
  @tracked errorText = '';
  @tracked lastEvent = 'nothing yet';

  setActivateOn = (v: string) => (this.activateOn = v);
  setCommitOn = (v: string) => (this.commitOn = v);
  setCanEdit = (v: boolean) => (this.canEdit = v);
  setErrorText = (v: string) => (this.errorText = v);

  commitTitle = (next: string) => {
    if (next.trim().length === 0) {
      this.errorText = 'A title cannot be empty.';
      this.lastEvent = 'commit refused';
      return false;
    }
    this.errorText = '';
    this.title = next;
    this.lastEvent = 'committed';
    return true;
  };
  cancelTitle = () => (this.lastEvent = 'cancelled');
  commitStatus = (next: string) => {
    this.status = next;
    this.lastEvent = 'status committed';
  };

  get activateOnValue() {
    return this.activateOn as 'button' | 'row';
  }
  get commitOnValue() {
    return this.commitOn as 'blur' | 'action';
  }
  get statusLabel() {
    let hit = this.statuses.find((option) => option.value === this.status);
    return hit ? hit.label : this.status;
  }
  get usage() {
    return "<EditInPlace @label='Title' @value={{this.title}} @activateOn='" +
      this.activateOn +
      "' @commitOn='" +
      this.commitOn +
      "' @onCommit={{this.save}}><:display>…</:display></EditInPlace>";
  }

  <template>
    <FreestyleUsage
      @name='EditInPlace'
      @description='A display value that becomes an editable field on activation and commits or cancels. Escape cancels, Enter commits, and leaving commits only when focus actually left the editor. The pencil is a real adjacent button, never a wrapper around the display, so a display holding a link is still a link.'
      @source={{this.usage}}
    >
      <:example>
        <div class='pretui-demo-eip'>
          <div class='pretui-demo-row'>
            <span class='pretui-demo-key'>Title</span>
            <EditInPlace
              @label='Title'
              @value={{this.title}}
              @placeholder='Add a title'
              @error={{this.errorText}}
              @activateOn={{this.activateOnValue}}
              @commitOn={{this.commitOnValue}}
              @canEdit={{this.canEdit}}
              @onCommit={{this.commitTitle}}
              @onCancel={{this.cancelTitle}}
            >
              <:display>
                <span class='pretui-demo-value'>{{this.title}}</span>
              </:display>
            </EditInPlace>
          </div>
          <div class='pretui-demo-row'>
            <span class='pretui-demo-key'>Status</span>
            {{!-- any of the kit inputs, not just text — the editor block
                  gets the draft api and wires whatever control it likes --}}
            <EditInPlace
              @label='Status'
              @value={{this.status}}
              @commitOn='action'
              @canEdit={{this.canEdit}}
              @onCommit={{this.commitStatus}}
            >
              <:display>
                <span class='pretui-demo-value'>{{this.statusLabel}}</span>
              </:display>
              <:editor as |editor|>
                <Select
                  @options={{this.statuses}}
                  @value={{editor.value}}
                  @controlId={{editor.controlId}}
                  @onValueChange={{editor.setValue}}
                />
              </:editor>
            </EditInPlace>
          </div>
        </div>
        <p class='pretui-demo-readout' data-test-eip-readout>
          {{this.lastEvent}}
        </p>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='label'
          @value='Title'
          @description='Required. It names the visually hidden label on the editor and the pencil button, because an unnamed editor is an unnamed editor.'
        />
        <Args.String
          @name='activateOn'
          @defaultValue='button'
          @value={{this.activateOn}}
          @options={{this.activations}}
          @description='button is the guaranteed path and is always present. row adds click-anywhere as a pointer enhancement, and it skips clicks that landed on a link or control inside the display so it can never swallow them.'
          @onInput={{this.setActivateOn}}
        />
        <Args.String
          @name='commitOn'
          @defaultValue='blur'
          @value={{this.commitOn}}
          @options={{this.commitModes}}
          @description='blur commits when focus genuinely leaves the editor, checked through relatedTarget containment rather than the upstream 50ms timer. action renders Save and Cancel and ignores blur entirely.'
          @onInput={{this.setCommitOn}}
        />
        <Args.Bool
          @name='canEdit'
          @defaultValue={{true}}
          @value={{this.canEdit}}
          @description='False renders the display content bare, with no wrapper and no dead affordance.'
          @onInput={{this.setCanEdit}}
        />
        <Args.String
          @name='error'
          @defaultValue=''
          @value={{this.errorText}}
          @description='Message under the editor, referenced by aria-describedby. Its line is reserved so an arriving error never shifts the row.'
          @onInput={{this.setErrorText}}
        />
        <Args.Action
          @name='onCommit'
          @description='Fires with the draft. Returning false refuses the commit and keeps the editor open with focus back on the control.'
        />
        <Args.Yield
          @name='editor'
          @description='Receives value, setValue, controlId, commit, cancel and invalid — enough to wire any control in the kit, which is why the Status row below is a Select.'
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .pretui-demo-eip {
        display: grid;
        gap: var(--space-3, 8px);
        max-width: 26rem;
      }
      .pretui-demo-row {
        display: grid;
        grid-template-columns: 5rem minmax(0, 1fr);
        align-items: center;
        gap: var(--space-3, 8px);
        padding: var(--space-2, 6px);
        border-radius: var(--radius);
        background: var(--card);
        box-shadow: 0 0 0 1px var(--border);
      }
      .pretui-demo-key {
        font-size: var(--text-ui-sm, 11.5px);
        font-weight: 500;
        color: var(--muted-foreground);
      }
      .pretui-demo-value {
        font-size: var(--text-ui-md, 12.5px);
      }
      .pretui-demo-readout {
        margin: var(--space-4, 12px) 0 0;
        font-size: var(--text-ui-sm, 11.5px);
        color: var(--muted-foreground);
      }
    </style>
  </template>
}

export const DEMOS_EDIT_IN_PLACE: Record<string, unknown> = {
  EditInPlace: EditInPlaceUsage,
};
