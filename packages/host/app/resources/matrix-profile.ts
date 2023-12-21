import { service } from '@ember/service';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';
import { Resource } from 'ember-resources';

import MatrixService from '@cardstack/host/services/matrix-service';

interface Args {
  named: {
    userId?: string | null;
  };
}

export class MatrixProfileResource extends Resource<Args> {
  @tracked userId: string | undefined | null;
  @tracked loaded: Promise<void> | undefined;
  @tracked avatarUrl: string | undefined;
  @tracked displayName: string | undefined;

  @service private declare matrixService: MatrixService;

  modify(_positional: never[], named: Args['named']) {
    let { userId } = named;
    this.userId = userId;

    this.loaded = this.load.perform();
  }

  load = restartableTask(async () => {
    if (this.userId) {
      let rawProfile = await this.matrixService.client.getProfileInfo(
        this.userId,
      );

      if (rawProfile) {
        this.avatarUrl = rawProfile.avatar_url;
        this.displayName = rawProfile.displayname;
      }
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
