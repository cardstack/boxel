// The Realm Runner environment, as the POC realm ships it, plus the tour
// director: one click sets a room up for the tour. The runner's modules
// stay in the POC realm until the host carries them.
import { action } from '@ember/object';
import UpdateRoomSkillsTool from '@cardstack/boxel-host/tools/update-room-skills';
import { RealmRunnerEnvironment } from 'https://realms-staging.stack.cards/ctse/assistant-realm-runner-poc/environment-v16';

const DIRECTOR_SKILL =
  'https://realms-staging.stack.cards/ctse/riverside-run-club/skills/riverside-tour-director/SKILL.md';

class TourEnvironmentComponent extends (RealmRunnerEnvironment.isolated as any) {
  @action
  addToAssistant(): void {
    void this.installForTour();
  }

  private installForTour = async (): Promise<void> => {
    await (this as any).installV29();
    let roomId = (this as any).assistantRoomId;
    let cx = (this.args as any).context?.commandContext;
    if ((this as any).addState !== 'added' || !roomId || !cx) {
      return;
    }
    try {
      await new UpdateRoomSkillsTool(cx).execute({
        roomId,
        skillCardIdsToActivate: [DIRECTOR_SKILL],
        skillCardIdsToDeactivate: [],
      });
    } catch (error: any) {
      (this as any).addState = 'error';
      (this as any).addError = error?.message || String(error);
    }
  };
}

export class TourEnvironment extends RealmRunnerEnvironment {
  static displayName = 'Tour environment';
  static isolated = TourEnvironmentComponent;
}
