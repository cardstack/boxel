import {
  CardDef,
  field,
  contains,
  linksTo,
  linksToMany,
  realmURL,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import DateTimeField from '@cardstack/base/datetime';
import NumberField from '@cardstack/base/number';
import { Command, codeRef } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import { Candidate } from '../candidate';
import { Employee } from '../employee';
import { Meeting } from '../meeting';
import { DurationField } from '../duration-field';
import { InterviewRoundField } from '../interview-round-field';

const here: string = import.meta.url;
const meetingRef = codeRef(here, '../meeting', 'Meeting');

// A Meeting's length in milliseconds, from its DurationField ({ value, unit }).
// Interviews without an explicit duration block a standard 60-minute slot —
// treating them as zero-length would let a new booking start ON TOP of an
// existing one and still pass the overlap check.
const DEFAULT_INTERVIEW_MINUTES = 60;
function durationMs(duration?: {
  value?: number | null;
  unit?: string | null;
}): number {
  let value = duration?.value;
  if (value == null || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_INTERVIEW_MINUTES * 60000;
  }
  switch (duration?.unit) {
    case 'minutes':
      return value * 60000;
    case 'hours':
      return value * 3600000;
    case 'days':
      return value * 86400000;
    default:
      // Weeks/months make no sense for a meeting; fall back to the slot size
      // rather than blocking an interviewer's whole quarter.
      return DEFAULT_INTERVIEW_MINUTES * 60000;
  }
}

class ScheduleInterviewInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field roundType = contains(InterviewRoundField);
  @field date = contains(DateTimeField);
  @field interviewers = linksToMany(() => Employee);
  @field durationMinutes = contains(NumberField, {
    description: 'Interview length in minutes (defaults to 60)',
  });
  @field ignoreConflicts = contains(BooleanField, {
    description:
      'Skip the double-booking check and create the meeting anyway (deliberate human override, defaults to false)',
  });
}

class ScheduleInterviewResult extends CardDef {
  @field meeting = linksTo(() => Meeting);
}

export class ScheduleInterviewCommand extends Command<
  typeof ScheduleInterviewInput,
  typeof ScheduleInterviewResult
> {
  static actionVerb = 'Schedule';
  static displayName = 'Schedule Interview';

  async getInputType() {
    return ScheduleInterviewInput;
  }

  protected async run(
    input: ScheduleInterviewInput,
  ): Promise<ScheduleInterviewResult> {
    let { candidate, roundType, date, interviewers, ignoreConflicts } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (!date) {
      throw new Error('date is required');
    }
    let minutes =
      input.durationMinutes && input.durationMinutes > 0
        ? input.durationMinutes
        : DEFAULT_INTERVIEW_MINUTES;

    // Double-booking guard: before creating anything, check every chosen
    // interviewer's existing meetings for a time overlap with the requested
    // slot ([date, date + duration) vs [m.date, m.date + m.duration)).
    // Throws naming the person and the clashing meeting so the caller can
    // pick another slot; `ignoreConflicts: true` is the deliberate override.
    let chosen = (interviewers ?? []).filter(Boolean);
    if (!ignoreConflicts && chosen.length) {
      let requestedStart = new Date(date).getTime();
      let requestedEnd = requestedStart + minutes * 60000;
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let searchResult = await search.execute({
        query: { filter: { type: meetingRef } },
      });
      let meetings = (searchResult.instances ?? []) as Meeting[];
      for (let meeting of meetings) {
        if (!meeting.date) {
          continue;
        }
        let start = new Date(meeting.date).getTime();
        if (isNaN(start)) {
          continue;
        }
        let end = start + durationMs(meeting.duration);
        if (requestedStart >= end || requestedEnd <= start) {
          continue; // no time overlap
        }
        let clashing = chosen.find((person) =>
          (meeting.interviewers ?? []).some((i) => i?.id === person.id),
        );
        if (clashing) {
          let when = new Date(start).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          throw new Error(
            `${clashing.name ?? 'An interviewer'} is already booked: "${
              meeting.title ?? 'Meeting'
            }" at ${when} overlaps the requested time. Pick another slot, or set ignoreConflicts to override.`,
          );
        }
      }
    }

    let meeting = new Meeting({
      name: `Interview: ${candidate.name ?? 'Candidate'}`,
      meetingType: 'interview',
      candidate,
      roundType,
      date,
      duration: new DurationField({ value: minutes, unit: 'minutes' }),
      interviewers: chosen,
    });
    let realm = candidate[realmURL]?.href;
    let savedMeeting = (await new SaveCardCommand(this.commandContext).execute({
      card: meeting,
      realm,
    } as any)) as Meeting;

    // Screening candidates who get an interview scheduled have started
    // interviewing — mirrors the same "advance the stage as a side effect of
    // the real-world action" pattern ExtractResumeCommand uses for applied →
    // screening.
    if (candidate.status === 'screening') {
      candidate.status = 'interviewing';
      await new SaveCardCommand(this.commandContext).execute({
        card: candidate,
      });
    }

    return new ScheduleInterviewResult({ meeting: savedMeeting });
  }
}
