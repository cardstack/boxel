import {
  CardDef,
  contains,
  field,
  linksTo,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Listing } from '../catalog-app/listing/listing';

const GITHUB_BRANCH_URL_PREFIX =
  'https://github.com/cardstack/boxel-catalog/tree/';

function encodeBranchName(branchName: string): string {
  return branchName
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

export class SubmissionCard extends CardDef {
  static displayName = 'SubmissionCard';

  @field roomId = contains(StringField);
  @field branchName = contains(StringField);
  @field githubURL = contains(StringField, {
    computeVia: function (this: SubmissionCard) {
      if (!this.branchName) {
        return undefined;
      }
      return `${GITHUB_BRANCH_URL_PREFIX}${encodeBranchName(this.branchName)}`;
    },
  });
  @field listing = linksTo(() => Listing);
}
