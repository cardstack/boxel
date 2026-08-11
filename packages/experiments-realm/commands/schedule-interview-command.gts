import {
  CardDef,
  field,
  contains,
  linksTo,
  linksToMany,
  realmURL,
} from '@cardstack/base/card-api';
import DateTimeField from '@cardstack/base/datetime';
import { Command } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';

import { Candidate } from '../candidate';
import { Employee } from '../employee';
import { Meeting } from '../meeting';
import { InterviewRoundField } from '../interview-round-field';

class ScheduleInterviewInput extends CardDef {
  @field candidate = linksTo(() => Candidate, { searchable: true });
  @field roundType = contains(InterviewRoundField);
  @field date = contains(DateTimeField);
  @field interviewers = linksToMany(() => Employee);
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
    let { candidate, roundType, date, interviewers } = input;
    if (!candidate) {
      throw new Error('candidate is required');
    }
    if (!date) {
      throw new Error('date is required');
    }

    let meeting = new Meeting({
      name: `Interview: ${candidate.name ?? 'Candidate'}`,
      meetingType: 'interview',
      candidate,
      roundType,
      date,
      interviewers: interviewers ?? [],
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
