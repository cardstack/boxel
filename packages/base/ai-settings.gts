import {
  CardDef,
  Component,
  linksToMany,
  field,
} from 'https://cardstack.com/base/card-api';
import { SkillCard } from 'https://cardstack.com/base/skill-card';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { on } from '@ember/modifier';
import GetAiSettingsCommand from '@cardstack/boxel-host/commands/get-ai-settings';
import SetAiSettingsCommand from '@cardstack/boxel-host/commands/set-ai-settings';
import { Button } from '@cardstack/boxel-ui/components';

export class AiSettingsCard extends CardDef {
  static displayName = 'AiSettingsCard';

  // Fields to store linked skill cards for each mode
  @field codeSkills = linksToMany(() => SkillCard);
  @field interactSkills = linksToMany(() => SkillCard);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked isLoading = false;
    @tracked message = '';

    @action
    async setAsDefault() {
      this.isLoading = true;
      this.message = '';

      try {
        let commandContext = this.args.context?.commandContext;
        let setAiSettingsCommand = new SetAiSettingsCommand(commandContext);

        await setAiSettingsCommand.execute(this.args.model);

        this.message = 'Settings set successfully';
      } catch (error) {
        console.error('Error setting default skills:', error);
        this.message = 'Error setting default skills';
      } finally {
        this.isLoading = false;
      }
    }

    <template>
      <div class='skills-manager'>
        <div class='content'>
          <h2 class='title'>Default Skills Manager</h2>

          <div class='skills-section'>
            <h3>Code Skills</h3>
            <div class='skills-list'>
              {{#if this.args.model.codeSkills.length}}
                <ul>
                  {{#each this.args.model.codeSkills as |skill|}}
                    <li>{{skill.id}}</li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='no-skills'>No code skills linked</p>
              {{/if}}
            </div>
          </div>

          <div class='skills-section'>
            <h3>Interact Skills</h3>
            <div class='skills-list'>
              {{#if this.args.model.interactSkills.length}}
                <ul>
                  {{#each this.args.model.interactSkills as |skill|}}
                    <li>{{skill.id}}</li>
                  {{/each}}
                </ul>
              {{else}}
                <p class='no-skills'>No interact skills linked</p>
              {{/if}}
            </div>
          </div>

          <div class='buttons-section'>

            <Button
              class='set-button'
              data-test-set-skills
              {{on 'click' this.setAsDefault}}
              disabled={{this.isLoading}}
            >
              Set Default Skills
            </Button>
          </div>

          {{#if this.message}}
            <div class='message {{if this.isLoading "loading"}}'>
              {{this.message}}
            </div>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .skills-manager {
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem;
        }

        .content {
          background: white;
          border-radius: 16px;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
          padding: 1.5rem;
        }

        .title {
          margin-top: 0;
          margin-bottom: 1.5rem;
          color: #1e293b;
          font-size: 1.5rem;
          text-align: center;
        }

        .skills-section {
          margin-bottom: 1.5rem;
          padding: 1rem;
          background: #f8fafc;
          border-radius: 8px;
        }

        .skills-section h3 {
          margin-top: 0;
          margin-bottom: 0.75rem;
          color: #334155;
          font-size: 1.2rem;
        }

        .skills-list ul {
          margin: 0;
          padding-left: 1.5rem;
        }

        .skills-list li {
          margin-bottom: 0.5rem;
          color: #475569;
        }

        .no-skills {
          color: #94a3b8;
          font-style: italic;
        }

        .current-skills {
          margin-bottom: 1.5rem;
          padding: 1rem;
          background: #f1f5f9;
          border-radius: 8px;
        }

        .current-skills h3 {
          margin-top: 0;
          margin-bottom: 1rem;
          color: #334155;
          font-size: 1.2rem;
        }

        .skills-display {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1rem;
        }

        .mode-skills h4 {
          margin-top: 0;
          margin-bottom: 0.5rem;
          color: #475569;
          font-size: 1rem;
        }

        .mode-skills ul {
          margin: 0;
          padding-left: 1.5rem;
        }

        .mode-skills li {
          margin-bottom: 0.5rem;
          color: #64748b;
          font-family: monospace;
          font-size: 0.9rem;
        }

        .buttons-section {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
        }

        .get-button,
        .set-button {
          flex: 1;
          padding: 0.75rem 1.5rem;
          font-size: 1.1rem;
          color: white;
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition:
            transform 0.2s,
            box-shadow 0.2s;
        }

        .get-button {
          background: linear-gradient(135deg, #4f46e5, #3730a3);
        }

        .set-button {
          background: linear-gradient(135deg, #34d399, #059669);
        }

        .get-button:hover,
        .set-button:hover {
          transform: translateY(-1px);
        }

        .get-button:hover {
          box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3);
        }

        .set-button:hover {
          box-shadow: 0 4px 12px rgba(52, 211, 153, 0.3);
        }

        .get-button[disabled],
        .set-button[disabled],
        .reset-button[disabled] {
          opacity: 0.5;
          cursor: not-allowed;
          transform: none;
          box-shadow: none;
        }

        .reset-button-section {
          margin-bottom: 1rem;
        }

        .reset-button {
          width: 100%;
          padding: 0.75rem 1.5rem;
          font-size: 1.1rem;
          color: white;
          background: linear-gradient(135deg, #ef4444, #b91c1c);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition:
            transform 0.2s,
            box-shadow 0.2s;
        }

        .reset-button:hover {
          transform: translateY(-1px);
          box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
        }

        .message {
          margin-top: 1rem;
          padding: 0.75rem;
          border-radius: 8px;
          text-align: center;
          font-weight: 500;
        }

        .message:not(.loading) {
          background: #e0f2fe;
          color: #0369a1;
        }

        .message.loading {
          background: #f1f5f9;
          color: #64748b;
        }
      </style>
    </template>
  };
}
