import {
  Component,
  field,
  contains,
  containsMany,
  linksTo,
  linksToMany,
  StringField,
} from '@cardstack/base/card-api';
import DateField from '@cardstack/base/date';
import NumberField from '@cardstack/base/number';
import TextAreaField from '@cardstack/base/text-area';
import UrlField from '@cardstack/base/url';
import enumField from '@cardstack/base/enum';
import { FileDef } from '@cardstack/base/file-api';
import UserSearchIcon from '@cardstack/boxel-icons/user-search';
import { htmlSafe } from '@ember/template';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq, or } from '@cardstack/boxel-ui/helpers';
import { Button } from '@cardstack/boxel-ui/components';

import { PersonBase } from './person-base';
import { ScoreField } from './score-field';
import { DurationField } from './duration-field';
import { Employee } from './employee';
import { Position } from './position';
import { Offer } from './offer';
import { Skill, SKILL_CATEGORY_COLORS } from './skill';
import { BackgroundCheckField } from './background-check-field';
import { InterviewFeedbackField } from './interview-feedback-field';
import { RejectionReasonField } from './rejection-reason-field';
import { WorkHistoryEntryField } from './work-history-entry-field';
import { EducationEntryField } from './education-entry-field';
import { INTERVIEW_ROUND_OPTIONS } from './interview-round-field';
import {
  daysBetween,
  liveCount,
  stateColor,
  stateColorOf,
  type StateColor,
} from './utils/index';
import { ExtractResumeCommand } from './commands/extract-resume-command';
import { GenerateInterviewQuestionsCommand } from './commands/generate-interview-questions-command';
import FileDownloadLink from './components/file-download-link';

export const CANDIDATE_STAGES = [
  'applied',
  'screening',
  'interviewing',
  'offer',
  'hired',
  'rejected',
];

// Colocated with Candidate — the same map drives the stage pill here, the
// Kanban board column/card border, and the calendar's meeting-kind chips.
// Harmonized with the Ledger identity so the color story carries meaning:
// offer glows brass (the seal color) and hired lands on the same forest
// green as Employee's "active" status — the pipeline visually resolves into
// the permanent record.
export const CANDIDATE_STAGE_COLORS: Record<string, StateColor> = {
  applied: stateColor('amber'),
  screening: stateColor('green'),
  interviewing: stateColor('purple'),
  offer: stateColor('orange'),
  hired: stateColor('green'),
  rejected: stateColor('red'),
};

export const CandidateStatusField = enumField(StringField, {
  options: CANDIDATE_STAGES.map((stage) => ({ value: stage, label: stage })),
  displayName: 'Candidate Stage',
});

export class Candidate extends PersonBase {
  static displayName = 'Candidate';
  static icon = UserSearchIcon;

  @field appliedRole = contains(StringField);
  @field position = linksTo(() => Position);
  @field offer = linksTo(() => Offer);
  @field appliedDate = contains(DateField);
  @field decisionDate = contains(DateField);
  @field status = contains(CandidateStatusField);
  @field resumeText = contains(TextAreaField, {
    description: 'Raw resume text; parsed by the Extract Resume command',
  });
  @field resumeFile = linksTo(FileDef, {
    searchable: true,
    description: 'The original resume file (PDF, etc.) for HR review',
  });
  @field linkedInUrl = contains(UrlField);
  @field portfolioUrl = contains(UrlField);
  @field referredBy = linksTo(() => Employee, {
    description: 'Employee who referred this candidate, if any',
  });
  @field noticePeriodDays = contains(NumberField, {
    description: 'Days of notice the candidate needs before starting',
  });
  @field interviewFeedback = containsMany(InterviewFeedbackField);
  @field skills = linksToMany(() => Skill);
  @field workHistory = containsMany(WorkHistoryEntryField);
  @field education = containsMany(EducationEntryField);
  @field overallScore = contains(ScoreField);
  // Status-tracking only — recording what the screening vendor reported, not
  // running the check. See background-check-field.gts for the boundary.
  @field backgroundCheck = contains(BackgroundCheckField);
  @field rejectionReason = contains(RejectionReasonField);
  // Free-text detail alongside the categorical reason — the reason drives
  // the Offers dashboard breakdown, this is the human-readable "what
  // happened" a recruiter can read back later.
  @field rejectionNote = contains(StringField);

  // Scalar mirror of the linked Offer's lifecycle, written by the offer
  // commands. The Pipeline board needs to tell "drafted but not sent" from
  // "sent, awaiting reply" on every render; reading the `offer` linksTo
  // synchronously in that hot path races the async link load and trips
  // Ember's "updated after use" assertion, which is why this scalar exists.
  @field offerState = contains(StringField, {
    description:
      "One of draft | extended | accepted | declined — mirrors the linked Offer's status for cheap board-side checks",
  });
  @field hiredAs = linksTo(() => Employee);
  @field boardOrder = contains(NumberField, {
    description:
      'Position within this candidate’s Kanban column; 1-based, lower sorts first',
  });

  // Denormalized for fitted — prerendered fitted does not resolve
  // linksToMany, so the fitted view reads this instead of skills.length.
  @field skillTally = contains(StringField, {
    computeVia: function (this: Candidate) {
      let n = liveCount(this.skills);
      return n === 0 ? '' : String(n);
    },
  });

  @field timeToHire = contains(DurationField, {
    computeVia: function (this: Candidate) {
      let days = daysBetween(this.appliedDate, this.decisionDate);
      if (days == null) {
        return undefined;
      }
      return new DurationField({ value: days, unit: 'days' });
    },
  });

  // What share of the linked Position's required skills this candidate's
  // linked skills cover, by card id. `undefined` (not 0%) when the position
  // isn't linked or lists no required skills — a missing denominator is not
  // the same fact as "matches nothing".
  @field skillMatchPct = contains(NumberField, {
    computeVia: function (this: Candidate) {
      let required = (this.position?.requiredSkills ?? []).filter(Boolean);
      if (required.length === 0) {
        return undefined;
      }
      let requiredIds = new Set(required.map((skill) => skill.id));
      let matchedSkillCount = (this.skills ?? [])
        .filter(Boolean)
        .filter((skill) => requiredIds.has(skill.id)).length;
      return Math.round(
        (matchedSkillCount / Math.max(1, requiredIds.size)) * 100,
      );
    },
  });

  @field title = contains(StringField, {
    computeVia: function (this: Candidate) {
      return this.name?.trim() || 'Unnamed Candidate';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked busyTool: 'extract' | 'questions' | undefined;
    @tracked toolError: string | undefined;
    @tracked toolMessage: string | undefined;
    @tracked selectedTab: 'overview' | 'tools' | 'resume' = 'overview';
    @tracked selectedRoundType: string | undefined = 'technical';

    setTab = (tab: 'overview' | 'tools' | 'resume') => {
      this.selectedTab = tab;
    };

    // A row of toggle buttons, not a <select> — matches how every other
    // small fixed-choice control in this app (offersView/directoryView tabs,
    // setTab above) is a row of `<button>`s bound to `eq` checks rather than
    // a native select. This is a MODE (which round the next generation call
    // targets), not a one-shot action, so it carries `aria-pressed` per the
    // "disable actions, never modes" guidance rather than a disabled state.
    roundTypeOptions = INTERVIEW_ROUND_OPTIONS;

    setRoundType = (value: string) => {
      this.selectedRoundType = value;
    };

    get stageColor() {
      return stateColorOf(CANDIDATE_STAGE_COLORS, this.args.model?.status);
    }

    get avatarRingStyle() {
      return htmlSafe(
        `box-shadow: 0 0 0 0.1875rem var(--background, var(--boxel-light)), 0 0 0 0.3125rem ${this.stageColor.ring};`,
      );
    }

    get stagePillStyle() {
      return htmlSafe(
        `background: ${this.stageColor.bg}; color: ${this.stageColor.fg};`,
      );
    }

    skillChipStyle = (
      skill: Skill | undefined,
    ): ReturnType<typeof htmlSafe> => {
      let c = SKILL_CATEGORY_COLORS[skill?.category ?? ''] ?? {
        bg: 'var(--muted, var(--boxel-100))',
        fg: 'var(--muted-foreground, var(--boxel-450))',
      };
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    };

    get extractDisabled(): boolean {
      return Boolean(this.busyTool) || !this.args.model?.resumeText?.trim();
    }

    get generateDisabled(): boolean {
      return Boolean(this.busyTool);
    }

    get noticePeriodLabel(): string | undefined {
      let n = this.args.model?.noticePeriodDays;
      if (n == null) {
        return undefined;
      }
      return n === 0 ? '0 days · available immediately' : `${n} days`;
    }

    get overallScoreLabel(): string | undefined {
      let v = this.args.model?.overallScore;
      if (v == null) {
        return undefined;
      }
      return v === 0 ? '0/5 · not yet scored' : `${v}/5`;
    }

    get matchScoreLabel(): string | undefined {
      let v = this.args.model?.skillMatchPct;
      return v == null ? undefined : `${v}% match`;
    }

    get visibleSkills() {
      return (this.args.model?.skills ?? []).slice(0, 6);
    }

    get extraSkillCount(): number {
      return Math.max(0, liveCount(this.args.model?.skills) - 6);
    }

    extractResume = async () => {
      if (this.extractDisabled) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.toolError = 'Commands are unavailable in this mode';
        return;
      }
      this.toolError = undefined;
      this.toolMessage = undefined;
      this.busyTool = 'extract';
      try {
        let result = await new ExtractResumeCommand(commandContext).execute({
          candidate: this.args.model,
        } as any);
        this.toolMessage = (result as any)?.summary;
      } catch (error: any) {
        this.toolError = error?.message ?? String(error);
      } finally {
        this.busyTool = undefined;
      }
    };

    generateQuestions = async () => {
      if (this.generateDisabled) {
        return;
      }
      let commandContext = this.args.context?.commandContext;
      if (!commandContext) {
        this.toolError = 'Commands are unavailable in this mode';
        return;
      }
      this.toolError = undefined;
      this.toolMessage = undefined;
      this.busyTool = 'questions';
      try {
        await new GenerateInterviewQuestionsCommand(commandContext).execute({
          candidate: this.args.model,
          roundType: this.selectedRoundType,
        } as any);
        this.toolMessage = 'Interview questions generated below.';
      } catch (error: any) {
        this.toolError = error?.message ?? String(error);
      } finally {
        this.busyTool = undefined;
      }
    };

    <template>
      <article class='candidate-isolated'>
        <header class='hero'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              style={{this.avatarRingStyle}}
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span
              class='avatar'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='hero-text'>
            <h1>{{@model.title}}</h1>
            <p class='byline'>
              {{if @model.appliedRole @model.appliedRole 'Role not recorded'}}
              {{#if @model.appliedDate}}
                <span class='sep-dot'>&middot;</span>
                applied
                <@fields.appliedDate />
              {{/if}}
            </p>
            <div class='pill-row'>
              {{#if @model.status}}
                <span class='pill' style={{this.stagePillStyle}}>
                  <span class='pill-dot'></span>{{@model.status}}
                </span>
              {{/if}}
              {{#if this.overallScoreLabel}}
                <span class='pill neutral'>&#9733;
                  {{this.overallScoreLabel}}</span>
              {{/if}}
              {{#if this.matchScoreLabel}}
                <span class='pill neutral'>{{this.matchScoreLabel}}</span>
              {{/if}}
              {{#if this.noticePeriodLabel}}
                <span class='pill neutral'>{{this.noticePeriodLabel}}</span>
              {{/if}}
            </div>
          </div>
        </header>

        <div class='body'>
          <div class='main'>
            <h2 class='panel-title'>Overview</h2>
            <dl class='facts'>
              <dt>Applied for</dt>
              <dd>{{if @model.appliedRole @model.appliedRole '—'}}</dd>
              <dt>Applied on</dt>
              <dd>{{#if @model.appliedDate}}<@fields.appliedDate
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Email</dt>
              <dd>{{if @model.email @model.email '—'}}</dd>
              <dt>Notice period</dt>
              <dd>{{if this.noticePeriodLabel this.noticePeriodLabel '—'}}</dd>
              <dt>Overall score</dt>
              <dd>{{if this.overallScoreLabel this.overallScoreLabel '—'}}</dd>
              <dt>Time to decision</dt>
              <dd>{{#if
                  @model.timeToHire.label
                }}{{@model.timeToHire.label}}{{else}}&mdash;{{/if}}</dd>
            </dl>

            <h2 class='panel-title spaced'>Skills</h2>
            {{#if @model.skills.length}}
              <ul class='chips'>
                {{#each this.visibleSkills as |skill|}}
                  <li>{{skill.title}}</li>
                {{/each}}
                {{#if this.extraSkillCount}}
                  <li class='more'>+{{this.extraSkillCount}}</li>
                {{/if}}
              </ul>
            {{else}}
              <p class='empty'>No skills recorded. Running Extract Resume will
                match them against the skill library.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Work history</h2>
            {{#if @model.workHistory.length}}
              <ul class='entry-list'>
                <@fields.workHistory />
              </ul>
            {{else}}
              <p class='empty'>No work history recorded. Running Extract
                Resume will populate it from the resume text.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Education</h2>
            {{#if @model.education.length}}
              <ul class='entry-list'>
                <@fields.education />
              </ul>
            {{else}}
              <p class='empty'>No education recorded. Running Extract Resume
                will populate it from the resume text.</p>
            {{/if}}

            {{#if @model.interviewFeedback.length}}
              <h2 class='panel-title spaced'>Interview feedback</h2>
              <dl class='facts'>
                {{#each @model.interviewFeedback as |fb|}}
                  <dt>{{if
                      fb.interviewer.name
                      fb.interviewer.name
                      'Unnamed'
                    }}</dt>
                  <dd>{{#if fb.score}}&#9733;
                      {{fb.score}}
                      &middot;
                    {{/if}}{{fb.notes}}</dd>
                {{/each}}
              </dl>
            {{/if}}

            <h2 class='panel-title spaced'>Background check</h2>
            {{#if @model.backgroundCheck.status}}
              <@fields.backgroundCheck />
            {{else}}
              <p class='empty'>No background check started.</p>
            {{/if}}

            {{#if @model.position.interviewPlan}}
              <h2 class='panel-title spaced'>Interview plan</h2>
              <@fields.position.interviewPlan @format='embedded' />
            {{else}}
              <h2 class='panel-title spaced'>Interview plan</h2>
              <p class='empty'>No interview plan yet — generate questions to
                create one.</p>
            {{/if}}

            <h2 class='panel-title spaced'>Resume</h2>
            {{! Two surfaces, two jobs: the PDF is what a human reads, the text
                is what the AI commands parse. Neither substitutes for the
                other — a PDF's bytes are not something the model can read. }}
            {{#if @model.resumeFile}}
              <div class='attach'>
                <FileDownloadLink @file={{@model.resumeFile}} />
              </div>
            {{else}}
              <p class='empty'>No resume file attached.</p>
            {{/if}}
            {{#if @model.resumeText}}
              <p class='prose'>{{@model.resumeText}}</p>
            {{else}}
              <p class='empty'>No resume text on file. Paste it into the
                <code>resumeText</code>
                field to enable Extract resume and Generate questions — the AI
                commands read the text, not the PDF.</p>
            {{/if}}
          </div>

          <aside class='side'>
            {{! Actions live in the aside rather than behind a tab — hiding
                them one click away taxes every single use. }}
            <h2 class='panel-title'>Actions</h2>
            {{#if @model.resumeText}}
              {{! Extract only renders when there is resume text to extract
                  from — a tool with an unmet precondition is noise, and the
                  Resume panel's empty state already explains how to enable
                  it. }}
              <div class='actions'>
                <Button
                  type='button'
                  @kind='secondary'
                  class='act'
                  @disabled={{this.extractDisabled}}
                  {{on 'click' this.extractResume}}
                >Extract resume</Button>
              </div>
            {{/if}}
            <p class='act-hint round-label'>Round to generate questions
              for</p>
            <div class='round-toggle' role='group' aria-label='Interview round'>
              {{#each this.roundTypeOptions as |option|}}
                <Button
                  type='button'
                  @kind='default'
                  @size='auto'
                  class='round-btn'
                  aria-pressed={{eq this.selectedRoundType option.value}}
                  {{on 'click' (fn this.setRoundType option.value)}}
                >{{option.label}}</Button>
              {{/each}}
            </div>
            <div class='actions'>
              <Button
                type='button'
                @kind='secondary'
                class='act'
                @disabled={{this.generateDisabled}}
                {{on 'click' this.generateQuestions}}
              >Generate questions</Button>
            </div>
            {{#unless @model.resumeText}}
              <p class='act-hint'>Paste resume text below before extracting.</p>
            {{/unless}}
            {{#if this.toolMessage}}
              <p class='act-msg' role='status'>{{this.toolMessage}}</p>
            {{/if}}

            <h2 class='panel-title spaced'>Related</h2>
            <dl class='facts stacked'>
              <dt>Position</dt>
              <dd>{{#if @model.position}}<@fields.position
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Referred by</dt>
              <dd>{{#if @model.referredBy}}<@fields.referredBy
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
              <dt>Offer</dt>
              <dd>{{#if @model.offer}}<@fields.offer
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash; not extended{{/if}}</dd>
              <dt>Hired as</dt>
              <dd>{{#if @model.hiredAs}}<@fields.hiredAs
                    @format='atom'
                    @displayContainer={{false}}
                  />{{else}}&mdash;{{/if}}</dd>
            </dl>

            {{#if @model.rejectionReason}}
              <h2 class='panel-title spaced'>Rejection reason</h2>
              <p class='side-note'>
                <@fields.rejectionReason
                  @format='atom'
                  @displayContainer={{false}}
                />
                {{#if @model.rejectionNote}}
                  &mdash;
                  {{@model.rejectionNote}}
                {{/if}}
              </p>
            {{/if}}
          </aside>
        </div>
      </article>
      <style scoped>
        .candidate-isolated {
          container-type: inline-size;
          container-name: iso;
          height: 100%;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          background: var(--background, var(--boxel-light));
          color: var(--foreground, var(--boxel-dark));
          font-family: var(--font-sans, var(--boxel-font-family));
          --cand-id: var(--primary, var(--boxel-highlight));
          --cand-strong: color-mix(
            in oklch,
            var(--cand-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
        }
        .avatar {
          flex: none;
          width: 3.25rem;
          height: 3.25rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-weight: 700;
          font-size: var(--boxel-font-size-sm);
          background: var(--cand-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .entry-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        .chips > li.more {
          border-style: dashed;
          color: var(--muted-foreground, var(--boxel-450));
          background: transparent;
        }
        .markdown {
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-height: 20rem;
          overflow-y: auto;
          border: 1px solid var(--border, var(--boxel-200));
          border-radius: var(--boxel-border-radius-sm);
          padding: var(--boxel-sp-xs);
        }
        .attach {
          font-size: var(--boxel-font-size-sm);
          margin-bottom: var(--boxel-sp-xs);
        }
        .empty code {
          font-family: var(--boxel-font-family-mono, ui-monospace, monospace);
          font-size: 0.92em;
        }
        .actions {
          display: grid;
          gap: 0.4rem;
        }
        .act {
          --boxel-button-secondary-background: transparent;
          --boxel-button-secondary-foreground: var(--cand-strong);
          --boxel-button-secondary-border: var(--cand-strong);
          --boxel-button-border-radius: var(--boxel-border-radius-sm);
          --boxel-button-padding: 0.5rem 0.75rem;
          --boxel-button-min-height: 2.75rem;
          --boxel-button-min-width: 0;
          font: inherit;
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .act:disabled {
          cursor: not-allowed;
        }
        .act-hint,
        .act-msg {
          margin: 0.4rem 0 0;
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .round-label {
          margin-top: 0.6rem;
        }
        .round-toggle {
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
          margin: 0.3rem 0 0.6rem;
        }
        .round-btn {
          --boxel-button-default-background: var(--card, var(--boxel-light));
          --boxel-button-default-foreground: var(
            --muted-foreground,
            var(--boxel-450)
          );
          --boxel-button-default-border: var(--border, var(--boxel-200));
          --boxel-button-border-radius: var(--boxel-border-radius-sm);
          --boxel-button-padding: 0.3rem 0.55rem;
          --boxel-button-min-height: 0;
          --boxel-button-min-width: 0;
          font: inherit;
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
        }
        .round-btn[aria-pressed='true'] {
          --boxel-button-color: var(--cand-strong);
          --boxel-button-text-color: var(--background, var(--boxel-light));
          --boxel-button-border: 1px solid var(--cand-strong);
        }
        .side-note {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.6;
          color: var(--muted-foreground, var(--boxel-450));
        }
        .dd-note {
          color: var(--muted-foreground, var(--boxel-450));
        }
        .hero {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-lg);
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .hero-text {
          flex: 1;
          min-width: 0;
        }
        h1 {
          margin: 0;
          font-size: var(--boxel-font-size-xl);
          font-weight: 750;
          letter-spacing: -0.02em;
          line-height: 1.2;
          overflow-wrap: anywhere;
          font-family: var(--font-heading, inherit);
        }
        .byline {
          margin: var(--boxel-sp-5xs) 0 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .sep-dot {
          margin: 0 0.25rem;
        }
        .pill-row {
          display: flex;
          flex-wrap: wrap;
          gap: var(--boxel-sp-5xs);
          margin-top: var(--boxel-sp-xs);
        }
        .pill {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          padding: 0.18em 0.5em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill.neutral {
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
        }
        .pill.stale {
          background: color-mix(
            in oklch,
            var(--boxel-warning) 12%,
            var(--card, var(--boxel-light))
          );
          color: color-mix(
            in oklch,
            var(--boxel-warning) 45%,
            var(--card-foreground, var(--boxel-dark))
          );
        }
        .pill-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .hero-money {
          flex: none;
          text-align: right;
        }
        .money {
          display: block;
          font-size: 1.5rem;
          font-weight: 800;
          line-height: 1.1;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .money-label {
          font-size: var(--boxel-font-size-xs);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .body {
          display: grid;
          grid-template-columns: 1fr 17rem;
          /* Fill whatever height is left so the aside's surface reaches the
             bottom edge. Without this the grid is only as tall as its content
             and the panel stops mid-card, reading as a cut-off seam. */
          flex: 1;
          min-height: 0;
          align-content: start;
        }
        .main {
          padding: var(--boxel-sp-lg);
          min-width: 0;
        }
        .side {
          padding: var(--boxel-sp-lg);
          border-left: 1px solid var(--border, var(--boxel-200));
          background: var(--muted, var(--boxel-100));
        }
        .panel-title {
          margin: 0 0 var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-sm);
          font-weight: 700;
        }
        .panel-title.spaced {
          margin-top: var(--boxel-sp-lg);
        }
        .prose {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          line-height: 1.65;
          max-width: 56ch;
          max-height: 16rem;
          overflow-y: auto;
        }
        .chips {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-wrap: wrap;
          gap: 0.3rem;
        }
        .chips > li {
          font-size: var(--boxel-font-size-xs);
          padding: 0.15em 0.5em;
          border-radius: 3px;
          border: 1px solid var(--border, var(--boxel-200));
          background: var(--card, var(--boxel-light));
        }
        .facts {
          margin: 0;
          display: grid;
          grid-template-columns: 9rem 1fr;
        }
        .facts.stacked {
          grid-template-columns: 1fr;
        }
        .facts dt {
          font-size: var(--boxel-font-size-xs);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground, var(--boxel-450));
          padding: 0.45rem var(--boxel-sp-xs) 0.45rem 0;
          border-bottom: 1px solid var(--border, var(--boxel-200));
        }
        .facts.stacked dt {
          border-bottom: 0;
          padding-bottom: 0;
        }
        .facts dd {
          margin: 0;
          padding: 0.45rem 0;
          font-size: var(--boxel-font-size-sm);
          border-bottom: 1px solid var(--border, var(--boxel-200));
          overflow-wrap: anywhere;
          font-variant-numeric: tabular-nums;
        }
        .facts.stacked dd {
          padding-top: 0.1rem;
        }
        .empty {
          margin: 0;
          font-size: var(--boxel-font-size-sm);
          color: var(--muted-foreground, var(--boxel-450));
        }
        @container iso (max-width: 40rem) {
          .body {
            grid-template-columns: 1fr;
          }
          .side {
            border-left: 0;
            border-top: 1px solid var(--border, var(--boxel-200));
          }
          .hero {
            flex-wrap: wrap;
          }
          .hero-money {
            text-align: left;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    get stageStyle() {
      let c = stateColorOf(CANDIDATE_STAGE_COLORS, this.args.model?.status);
      return htmlSafe(`background: ${c.bg}; color: ${c.fg};`);
    }
    get scoreLabel() {
      let v = this.args.model?.overallScore;
      return typeof v === 'number' ? `\u2605 ${v}` : null;
    }
    <template>
      <div class='candidate-embedded'>
        {{#if @model.photo.resolvedUrl}}
          <img class='ce-avatar' src={{@model.photo.resolvedUrl}} alt='' />
        {{else}}
          <span class='ce-avatar ce-initials'>{{@model.initials}}</span>
        {{/if}}
        <div class='ce-main'>
          <span class='ce-name'>{{if @model.name @model.name 'Unnamed'}}</span>
          {{#if @model.appliedRole}}
            <span class='ce-role'>{{@model.appliedRole}}</span>
          {{/if}}
        </div>
        <div class='ce-side'>
          {{#if @model.status}}
            <span
              class='ce-stage'
              style={{this.stageStyle}}
            >{{@model.status}}</span>
          {{/if}}
          {{#if this.scoreLabel}}
            <span class='ce-score'>{{this.scoreLabel}}</span>
          {{/if}}
        </div>
      </div>
      <style scoped>
        .candidate-embedded {
          display: flex;
          align-items: center;
          gap: 0.625rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.8125rem;
        }
        .ce-avatar {
          width: 30px;
          height: 30px;
          border-radius: 50%;
          object-fit: cover;
          flex-shrink: 0;
        }
        .ce-initials {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-450));
          font-size: 0.6875rem;
          font-weight: 700;
        }
        .ce-main {
          display: flex;
          flex-direction: column;
          gap: 0.0625rem;
          min-width: 0;
          flex: 1;
        }
        .ce-name {
          font-weight: 600;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ce-role {
          font-size: 0.6875rem;
          color: var(--muted-foreground, var(--boxel-450));
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .ce-side {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          gap: 0.1875rem;
          flex-shrink: 0;
        }
        .ce-stage {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          padding: 0.125rem 0.4375rem;
          border-radius: 999px;
        }
        .ce-score {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--muted-foreground, var(--boxel-450));
          font-variant-numeric: tabular-nums;
        }
      </style>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template>
      <span class='candidate-atom'>
        <UserSearchIcon class='candidate-atom-icon' />
        <span class='candidate-atom-name'>{{@model.title}}</span>
      </span>
      <style scoped>
        .candidate-atom {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.8125rem;
          font-weight: 500;
          color: var(--foreground, var(--boxel-dark));
        }
        .candidate-atom-icon {
          width: 14px;
          height: 14px;
          color: var(--muted-foreground, var(--boxel-450));
          flex-shrink: 0;
        }
        .candidate-atom-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    get stageColor() {
      return stateColorOf(CANDIDATE_STAGE_COLORS, this.args.model?.status);
    }

    get avatarRingStyle() {
      return htmlSafe(
        `box-shadow: 0 0 0 0.125rem var(--background, var(--boxel-light)), 0 0 0 0.1875rem ${this.stageColor.ring};`,
      );
    }

    get stagePillStyle() {
      return htmlSafe(
        `background: ${this.stageColor.bg}; color: ${this.stageColor.fg};`,
      );
    }

    get pipelineSteps() {
      let order = ['applied', 'screening', 'interviewing', 'offer', 'hired'];
      let status = this.args.model?.status;
      let idx = status === 'rejected' ? -1 : order.indexOf(status ?? '');
      return order.map((step, i) => ({ step, done: idx >= 0 && i <= idx }));
    }
    get daysInPipeline(): number | undefined {
      return daysBetween(this.args.model?.appliedDate);
    }
    get scoreShort(): string | undefined {
      let v = this.args.model?.overallScore;
      return typeof v === 'number' ? `\u2605 ${v}/5` : undefined;
    }

    <template>
      <article class='fit'>
        <div class='fit-top'>
          {{#if @model.photo.resolvedUrl}}
            <img
              class='avatar avatar-photo'
              style={{this.avatarRingStyle}}
              src={{@model.photo.resolvedUrl}}
              alt=''
            />
          {{else}}
            <span
              class='avatar'
              style={{this.avatarRingStyle}}
            >{{@model.initials}}</span>
          {{/if}}
          <div class='fit-head'>
            <h3 class='fit-name'>{{@model.title}}</h3>
            {{#if @model.appliedRole}}
              <span class='fit-eb'>{{@model.appliedRole}}</span>
            {{/if}}
          </div>
          {{! Stage pill survives every tier — it is the only thing that says
              where this person is in the pipeline. }}
          {{#if @model.status}}
            <span class='fit-pill' style={{this.stagePillStyle}}>
              <span class='pill-dot'></span>{{@model.status}}
            </span>
          {{/if}}
        </div>

        <div class='fit-mid'>
          {{#if this.scoreShort}}
            <span class='money'>{{this.scoreShort}}</span>
          {{/if}}
          {{#if this.daysInPipeline}}
            <span class='fit-sub'>{{this.daysInPipeline}}d in pipeline</span>
          {{/if}}
        </div>

        <dl class='fit-add'>
          {{! Reads the denormalized tally, not skills.length — a linksToMany
              read here is not resolved in prerendered fitted. }}
          {{#if @model.skillTally}}
            <div><dt>Skills</dt><dd>{{@model.skillTally}}</dd></div>
          {{/if}}
          {{#if @model.appliedDate}}
            <div><dt>Applied</dt><dd><@fields.appliedDate /></dd></div>
          {{/if}}
          {{#if @model.noticePeriodDays}}
            <div><dt>Notice</dt><dd>{{@model.noticePeriodDays}}d</dd></div>
          {{/if}}
          {{#if @model.timeToHire.label}}
            <div><dt>To hire</dt><dd>{{@model.timeToHire.label}}</dd></div>
          {{/if}}
        </dl>
      </article>
      <style scoped>
        /* Four tiers, each ADDING fields. 11px floor (was 8px). Pill always on. */
        .fit {
          height: 100%;
          /* Flex, not a three-row grid: with `minmax(0, 1fr)` in the middle
             a taller bottom block squeezed the middle row and clipped its
             text. Here the middle keeps its natural height and the extras
             block is pushed to the bottom by `margin-top: auto`. */
          display: flex;
          flex-direction: column;
          gap: 0.28rem;
          padding: 0.55rem 0.6rem;
          overflow: hidden;
          background: var(--card, var(--boxel-light));
          color: var(--card-foreground, var(--foreground, var(--boxel-dark)));
          font-family: var(--font-sans, var(--boxel-font-family));
          --cand-id: var(--primary, var(--boxel-highlight));
          --cand-strong: color-mix(
            in oklch,
            var(--cand-id) 45%,
            var(--foreground, var(--boxel-dark))
          );
          --fit-name: clamp(11px, 3.2cqi, 15px);
          --fit-small: clamp(11px, 2.6cqi, 12px);
        }
        .avatar {
          flex: none;
          width: 1.6rem;
          height: 1.6rem;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-size: var(--fit-small);
          font-weight: 700;
          background: var(--cand-strong);
          color: var(--background, var(--boxel-light));
        }
        .avatar-photo {
          object-fit: cover;
        }
        .fit > * {
          min-height: 0;
          overflow: hidden;
        }
        .fit-top {
          flex: none;
          display: flex;
          align-items: flex-start;
          gap: 0.4rem;
          flex-wrap: wrap;
          /* The photo avatar's ring (box-shadow, painted outside its own
             box) was being clipped along its top edge by the inherited
             `.fit > * { overflow: hidden }` rule — the ring bled above
             this row's flex-start-aligned top edge with no padding to
             absorb it, reading as a cropped circle. */
          overflow: visible;
        }
        .fit-head {
          flex: 1;
          min-width: 0;
        }
        .fit-name {
          margin: 0;
          font-size: var(--fit-name);
          font-weight: 700;
          line-height: 1.25;
          letter-spacing: -0.01em;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .fit-eb {
          display: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-pill {
          flex: none;
          align-self: flex-start;
          display: inline-flex;
          align-items: center;
          gap: 0.25rem;
          font-size: var(--fit-small);
          font-weight: 700;
          padding: 0.1em 0.4em;
          border-radius: 3px;
          white-space: nowrap;
        }
        .pill-dot {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: currentColor;
          flex: none;
        }
        .fit-mid {
          flex: none;
          display: none;
          flex-direction: column;
          gap: 1px;
        }
        .money {
          font-size: calc(var(--fit-name) * 1.15);
          font-weight: 800;
          letter-spacing: -0.02em;
          font-variant-numeric: tabular-nums;
        }
        .fit-sub {
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .fit-add {
          display: none;
          margin: 0;
          margin-top: auto;
          padding-top: 0.3rem;
          border-top: 1px dashed var(--border, var(--boxel-200));
          grid-template-columns: 1fr 1fr;
          gap: 0.05rem 0.5rem;
        }
        .fit-add > div {
          display: flex;
          gap: 0.25rem;
          min-width: 0;
        }
        .fit-add dt {
          flex: none;
          font-size: var(--fit-small);
          color: var(--muted-foreground, var(--boxel-450));
        }
        .fit-add dd {
          margin: 0;
          font-size: var(--fit-small);
          font-weight: 600;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
          font-variant-numeric: tabular-nums;
        }

        /* TIER 2 — add the secondary line. Container queries have no `or`,
           so this is reached either by height (tile) or width (strip). */
        @container fitted-card (height > 80px) {
          .fit-eb {
            display: block;
          }
        }
        @container fitted-card (width > 240px) {
          .fit-eb {
            display: block;
          }
        }
        /* TIER 3 — add the headline figure block. */
        @container fitted-card (height > 130px) and (width > 180px) {
          .fit-mid {
            display: flex;
          }
        }
        /* TIER 4 — width-driven extra facts. Previously absent entirely,
           which is why a 500x400 tile showed the same as a 200x140 one. */
        @container fitted-card (height > 150px) and (width > 180px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
        @container fitted-card (width > 340px) and (height > 130px) {
          .fit-add {
            display: grid;
            grid-template-columns: 1fr 1fr;
          }
        }
        /* Short strip: horizontal, single-line name. */
        @container fitted-card (height <= 90px) {
          .fit {
            grid-template-rows: 1fr;
            align-content: center;
          }
          .fit-top {
            align-items: center;
            flex-wrap: nowrap;
          }
          .fit-pill {
            align-self: center;
          }
          .fit-name {
            -webkit-line-clamp: 1;
          }
        }
        /* Smallest tier: secondary line goes, the status pill stays. */
        @container fitted-card (height <= 50px) {
          .fit-eb {
            display: none;
          }
        }
      </style>
    </template>
  };
}
