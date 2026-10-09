// The host half of `room.*`: what a run asks to change in the AI assistant
// room it was called from. The sandbox has no access to Matrix, so a call only
// records the request, after the host's own checks. The host makes the changes
// once the script has finished, and only when it finished without an error.

// How many skills one call may name.
const MAX_SKILLS_PER_CALL = 20;

export interface RoomActionChecks {
  // Throws unless `id` names a skill card or a skill markdown file.
  checkSkill(id: string): Promise<void>;
  // The model ids the room may switch to.
  knownModels(): string[];
}

export interface RequestedRoomChanges {
  skillsToEnable: string[];
  skillsToDisable: string[];
  model?: string;
}

export class RoomActions {
  // skill id -> true to enable, false to disable. A later call for the same
  // skill replaces an earlier one.
  private skills = new Map<string, boolean>();
  private model: string | undefined;

  constructor(private checks: RoomActionChecks) {}

  get requested(): RequestedRoomChanges | undefined {
    if (this.skills.size === 0 && this.model === undefined) {
      return undefined;
    }
    let entries = [...this.skills.entries()];
    return {
      skillsToEnable: entries.filter(([, on]) => on).map(([id]) => id),
      skillsToDisable: entries.filter(([, on]) => !on).map(([id]) => id),
      ...(this.model !== undefined ? { model: this.model } : {}),
    };
  }

  async enableSkills(rawIds: unknown) {
    let ids = skillIds('room.enableSkills', rawIds);
    for (let id of ids) {
      await this.checks.checkSkill(id);
    }
    for (let id of ids) {
      this.skills.set(id, true);
    }
    return { enable: ids, appliedAfterRun: true };
  }

  disableSkills(rawIds: unknown) {
    let ids = skillIds('room.disableSkills', rawIds);
    for (let id of ids) {
      this.skills.set(id, false);
    }
    return { disable: ids, appliedAfterRun: true };
  }

  setModel(model: unknown) {
    if (typeof model !== 'string' || model.trim().length === 0) {
      throw new TypeError('room.setModel expects a model id string');
    }
    model = model.trim();
    let known = this.checks.knownModels();
    if (!known.includes(model as string)) {
      throw new Error(
        `Unknown model: ${model}. Models this room can use: ${known.join(', ')}`,
      );
    }
    this.model = model as string;
    return { model, appliedAfterRun: true };
  }
}

function skillIds(method: string, raw: unknown): string[] {
  let list = typeof raw === 'string' ? [raw] : raw;
  if (
    !Array.isArray(list) ||
    list.length === 0 ||
    list.some((id) => typeof id !== 'string' || id.trim().length === 0)
  ) {
    throw new TypeError(`${method} expects an array of skill id strings`);
  }
  if (list.length > MAX_SKILLS_PER_CALL) {
    throw new Error(
      `${method} may name at most ${MAX_SKILLS_PER_CALL} skills in one call`,
    );
  }
  return [...new Set((list as string[]).map((id) => id.trim()))];
}
