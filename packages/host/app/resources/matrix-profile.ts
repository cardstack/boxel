import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask, all } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import MatrixService from '@cardstack/host/services/matrix-service';

interface Args {
  named: {
    userId?: string | null;
  };
}

export class MatrixProfileResource extends Resource<Args> {
  @tracked userId: string | undefined | null;
  @tracked email: string | undefined;
  @tracked threePids: string[] = [];
  @tracked loaded: Promise<void> | undefined;
  @tracked avatarUrl: string | undefined;
  @tracked displayName: string | undefined;

  @service declare private matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    let { userId } = named;
    this.userId = userId;

    this.loaded = this.load.perform();
  }

  load = restartableTask(async () => {
    if (this.userId) {
      let [rawProfile, threePid] = await all([
        this.matrixService.getProfileInfo(this.userId),
        this.matrixService.getThreePids(),
      ]);

      if (rawProfile) {
        this.avatarUrl = rawProfile.avatar_url;
        this.displayName = rawProfile.displayname;
      }
      let { threepids } = threePid;
      this.email = threepids.find((t) => t.medium === 'email')?.address;
      this.threePids = threepids
        .filter((t) => t.medium === 'email')
        .map((t) => t.address);
    }
  });
}

export function getMatrixProfile(
  parent: object,
  userId: () => string | undefined | null,
) {
  return MatrixProfileResource.from(parent, () => ({
    named: {
      userId: userId(),
    },
  }));
}
