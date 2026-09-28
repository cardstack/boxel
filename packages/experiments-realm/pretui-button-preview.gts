import { CardDef, Component } from '@cardstack/base/card-api';
import { on } from '@ember/modifier';
import { tracked } from '@glimmer/tracking';
import { Button } from '@cardstack/pretui/components/button';
import { ButtonGroup } from '@cardstack/pretui/components/button-group';
import {
  PRETUI_APPEARANCES,
  PRETUI_SIZES,
  PRETUI_TONES,
} from '@cardstack/pretui/pretui-primitives';

// Every Pret UI Button treatment on one page, for visual review in the
// card's own theme.
export class PretuiButtonPreview extends CardDef {
  static displayName = 'Pret UI Button Preview';

  static isolated = class Isolated extends Component<
    typeof PretuiButtonPreview
  > {
    tones = PRETUI_TONES;
    appearances = PRETUI_APPEARANCES;
    sizes = PRETUI_SIZES;

    @tracked saving = false;
    private timer: ReturnType<typeof setTimeout> | undefined;

    save = () => {
      this.saving = true;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => (this.saving = false), 3000);
    };

    willDestroy() {
      super.willDestroy();
      clearTimeout(this.timer);
    }

    <template>
      <article class='preview'>
        <header>
          <h1><@fields.cardTitle /></h1>
          <p>Every tone × appearance, then states, sizes and button groups.</p>
        </header>

        <section aria-labelledby='matrix-heading'>
          <h2 id='matrix-heading'>Tone × appearance</h2>
          <div class='scroll'>
            <table>
              <thead>
                <tr>
                  <th scope='col'>Tone</th>
                  {{#each this.appearances as |appearance|}}
                    <th scope='col'>{{appearance}}</th>
                  {{/each}}
                </tr>
              </thead>
              <tbody>
                {{#each this.tones as |tone|}}
                  <tr>
                    <th scope='row'>{{tone}}</th>
                    {{#each this.appearances as |appearance|}}
                      <td>
                        <Button
                          @tone={{tone}}
                          @appearance={{appearance}}
                        >Action</Button>
                      </td>
                    {{/each}}
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby='states-heading'>
          <h2 id='states-heading'>States</h2>
          <div class='scroll'>
            <table>
              <thead>
                <tr>
                  <th scope='col'>State</th>
                  {{#each this.appearances as |appearance|}}
                    <th scope='col'>{{appearance}}</th>
                  {{/each}}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope='row'>rest</th>
                  {{#each this.appearances as |appearance|}}
                    <td><Button @appearance={{appearance}}>Save</Button></td>
                  {{/each}}
                </tr>
                <tr>
                  <th scope='row'>disabled</th>
                  {{#each this.appearances as |appearance|}}
                    <td><Button
                        @appearance={{appearance}}
                        @disabled={{true}}
                      >Save</Button></td>
                  {{/each}}
                </tr>
                <tr>
                  <th scope='row'>busy</th>
                  {{#each this.appearances as |appearance|}}
                    <td><Button
                        @appearance={{appearance}}
                        @busy={{true}}
                      >Saving</Button></td>
                  {{/each}}
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby='busy-heading'>
          <h2 id='busy-heading'>Busy with focus</h2>
          <p>Tab to the button and press Enter: it stays focused and ignores
            presses for three seconds while busy.</p>
          <div class='row'>
            <Button
              @busy={{this.saving}}
              @busyLabel='Saving'
              {{on 'click' this.save}}
            >
              Save changes
            </Button>
          </div>
        </section>

        <section aria-labelledby='sizes-heading'>
          <h2 id='sizes-heading'>Sizes</h2>
          <div class='row'>
            {{#each this.sizes as |size|}}
              <Button @size={{size}}>Size {{size}}</Button>
            {{/each}}
          </div>
        </section>

        <section aria-labelledby='group-heading'>
          <h2 id='group-heading'>Button group</h2>
          <p>Children are plain Buttons; the group passes its tone, appearance
            and size down.</p>
          <div class='scroll'>
            <table>
              <thead>
                <tr>
                  <th scope='col'>Tone</th>
                  {{#each this.appearances as |appearance|}}
                    <th scope='col'>{{appearance}}</th>
                  {{/each}}
                </tr>
              </thead>
              <tbody>
                {{#each this.tones as |tone|}}
                  <tr>
                    <th scope='row'>{{tone}}</th>
                    {{#each this.appearances as |appearance|}}
                      <td>
                        <ButtonGroup
                          @label='Alignment'
                          @tone={{tone}}
                          @appearance={{appearance}}
                        >
                          <Button>Left</Button>
                          <Button>Center</Button>
                          <Button>Right</Button>
                        </ButtonGroup>
                      </td>
                    {{/each}}
                  </tr>
                {{/each}}
              </tbody>
            </table>
          </div>
          <h3>Sizes</h3>
          <div class='row'>
            {{#each this.sizes as |size|}}
              <ButtonGroup
                @label='Size {{size}}'
                @tone='neutral'
                @appearance='outlined'
                @size={{size}}
              >
                <Button>Day</Button>
                <Button>Week</Button>
                <Button>Month</Button>
              </ButtonGroup>
            {{/each}}
          </div>
          <h3>States inside a group</h3>
          <div class='row'>
            <ButtonGroup
              @label='Editing'
              @tone='neutral'
              @appearance='outlined'
            >
              <Button>Undo</Button>
              <Button @disabled={{true}}>Redo</Button>
              <Button @busy={{true}}>Saving</Button>
            </ButtonGroup>
          </div>
          <h3>Vertical</h3>
          <div class='row'>
            {{#each this.appearances as |appearance|}}
              <ButtonGroup
                @label='Layout'
                @orientation='vertical'
                @tone='primary'
                @appearance={{appearance}}
              >
                <Button>Top</Button>
                <Button>Middle</Button>
                <Button>Bottom</Button>
              </ButtonGroup>
            {{/each}}
          </div>
        </section>
      </article>
      <style scoped>
        .preview {
          height: 100%;
          overflow-y: auto;
          display: grid;
          align-content: start;
          gap: var(--boxel-sp-xl);
          padding: var(--boxel-sp-lg);
        }
        h1,
        h2,
        h3,
        p {
          margin: 0;
        }
        header,
        section {
          display: grid;
          gap: var(--boxel-sp-sm);
        }
        header p,
        section > p {
          color: var(--muted-foreground);
        }
        .scroll {
          overflow-x: auto;
        }
        table {
          border-collapse: collapse;
        }
        th {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
          text-align: start;
          font-weight: 500;
          color: var(--muted-foreground);
        }
        td {
          padding: var(--boxel-sp-xs) var(--boxel-sp-sm);
        }
        .row {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: var(--boxel-sp-sm);
        }
      </style>
    </template>
  };
}
