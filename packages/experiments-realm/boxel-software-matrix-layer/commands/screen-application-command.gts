import {
  CardDef,
  field,
  contains,
  linksTo,
  realmURL,
  StringField,
} from '@cardstack/base/card-api';
import { Command, codeRef } from '@cardstack/runtime-common';
import SaveCardCommand from '@cardstack/boxel-host/commands/save-card';
import { SearchCardsByQueryCommand } from '@cardstack/boxel-host/commands/search-cards';

import ImageSourceField from '@cardstack/catalog/fields/image-source/image-source';

import { Application } from '../application';
import { Candidate } from '../candidate';
import type { Employee } from '../employee';

const here: string = import.meta.url;
const employeeRef = codeRef(here, '../employee', 'Employee');

class ScreenApplicationInput extends CardDef {
  @field application = linksTo(() => Application, { searchable: true });
}

class ScreenApplicationResult extends CardDef {
  @field message = contains(StringField);
  @field candidate = linksTo(() => Candidate);
}

export class ScreenApplicationCommand extends Command<
  typeof ScreenApplicationInput,
  typeof ScreenApplicationResult
> {
  static actionVerb = 'Screen';
  static displayName = 'Screen Application';

  async getInputType() {
    return ScreenApplicationInput;
  }

  protected async run(
    input: ScreenApplicationInput,
  ): Promise<ScreenApplicationResult> {
    let { application } = input;
    if (!application) {
      throw new Error('application is required');
    }
    if (application.status === 'converted') {
      throw new Error('This application has already been converted');
    }

    // referrerName is free text on Application; Candidate.referredBy is a
    // real linksTo(Employee). Resolve it only when there's exactly one
    // name match — silently linking the wrong person on an ambiguous or
    // absent match is worse than leaving it blank for a human to set.
    let referredBy: Employee | undefined;
    let referrerName = application.referrerName?.trim().toLowerCase();
    if (referrerName) {
      let search = new SearchCardsByQueryCommand(this.commandContext);
      let searchResult = await search.execute({
        query: { filter: { type: employeeRef } },
      });
      let employees = (searchResult.instances ?? []) as Employee[];
      let matches = employees.filter(
        (e) => (e.name ?? '').trim().toLowerCase() === referrerName,
      );
      if (matches.length === 1) {
        referredBy = matches[0];
      }
    }

    let realm = application[realmURL]?.href;
    let candidate = new Candidate({
      name: application.name,
      email: application.email,
      phone: application.phone,
      photo: application.photo?.resolvedUrl
        ? new ImageSourceField({
            url: application.photo.url,
            file: application.photo.file,
            sourceMode: application.photo.sourceMode,
          })
        : undefined,
      appliedRole: application.position?.jobTitle,
      position: application.position,
      appliedDate: application.appliedDate ?? new Date(),
      resumeText: application.resumeText,
      resumeFile: application.resumeFile,
      referredBy,
      status: 'screening',
    });
    let saved = (await new SaveCardCommand(this.commandContext).execute({
      card: candidate,
      realm,
    } as any)) as Candidate;

    application.status = 'converted';
    await new SaveCardCommand(this.commandContext).execute({
      card: application,
    });

    return new ScreenApplicationResult({
      message: `${
        application.name ?? 'Applicant'
      } moved into the pipeline as a candidate.`,
      candidate: saved,
    });
  }
}
