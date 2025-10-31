import * as vscode from 'vscode';
import type { RealmAuth } from './realm-auth';
import * as fs from 'fs';
import * as path from 'path';
import type { LocalFileSystem } from './local-file-system';

export interface StoredSkillData {
  skillLists: {
    label: string;
    realmUrl: string;
    readOnly: boolean;
    skills: {
      id: string;
      label: string;
      instructions: string;
    }[];
  }[];
  lastFetched: number;
}

export interface SkillStateData {
  enabledSkillIds: string[];
  lastUpdated: number;
}

export class SkillsProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  private skillLists: SkillList[] = [];
  private dataPath: string;
  private cursorRulesPath: string;
  private enabledSkillIds: Set<string> = new Set();

  constructor(
    private realmAuth: RealmAuth,
    private context: vscode.ExtensionContext,
    private localFileSystem: LocalFileSystem,
  ) {
    // Use the local storage path provided by LocalFileSystem
    this.dataPath = path.join(
      this.localFileSystem.getLocalStoragePath(),
      '.skills',
    );
    this.cursorRulesPath = path.join(
      this.localFileSystem.getLocalStoragePath(),
      '.cursorrules',
    );
    // Create the skills directory if it doesn't exist
    if (!fs.existsSync(this.dataPath)) {
      fs.mkdirSync(this.dataPath, { recursive: true });
    }

    // Try to load skills and state from storage
    this.loadSkillState();
    this.loadSkillsFromStorage();
  }

  getSkillInstructions(skillId: string): string | undefined {
    for (const skillList of this.skillLists) {
      const skill = skillList.skills.find((s) => s.id === skillId);
      if (skill) {
        return skill.instructions;
      }
    }
    return undefined;
  }

  getSelectedSkills(): Skill[] {
    const allSkills = this.skillLists.flatMap((skillList) => skillList.skills);
    const selectedSkills = allSkills.filter(
      (skill) => skill.checkboxState === vscode.TreeItemCheckboxState.Checked,
    );
    console.log('All skills: ', allSkills);
    console.log('Selected skills: ', selectedSkills);
    return selectedSkills;
  }

  updateCursorRules(): void {
    // Get all selected skills and write to .cursorrules file
    const selectedSkills = this.getSelectedSkills();
    let combinedText = '';

    for (const skill of selectedSkills) {
      combinedText += `${skill.instructions}\n`;
    }

    // Get the workspace folder

    console.log('Cursor rules path: ', this.cursorRulesPath);

    try {
      // Ensure the directory exists before writing the file
      const cursorRulesDir = path.dirname(this.cursorRulesPath);
      if (!fs.existsSync(cursorRulesDir)) {
        fs.mkdirSync(cursorRulesDir, { recursive: true });
      }

      fs.writeFileSync(this.cursorRulesPath, combinedText);
      console.log('.cursorrules file updated successfully');
    } catch (error) {
      console.error('Error writing .cursorrules file:', error);
      vscode.window.showErrorMessage('Failed to write .cursorrules file');
    }
  }

  // Save skills to storage
  private saveSkillsToStorage(): void {
    try {
      const skillsDataPath = path.join(this.dataPath, 'skills_data.json');

      // Convert skill lists to a format suitable for storage, preserving the hierarchy
      const skillListsData = this.skillLists.map((list) => ({
        label: list.label,
        realmUrl: list.realmUrl,
        readOnly: list.readOnly,
        skills: list.skills.map((skill) => ({
          id: skill.id,
          label: skill.label,
          instructions: skill.instructions,
        })),
      }));

      const dataToStore: StoredSkillData = {
        skillLists: skillListsData,
        lastFetched: Date.now(),
      };

      fs.writeFileSync(skillsDataPath, JSON.stringify(dataToStore, null, 2));
      console.log('Skills saved to storage successfully');
    } catch (error) {
      console.error('Error saving skills to storage:', error);
    }
  }

  // Save skill state (enabled/disabled) separately
  private saveSkillState(): void {
    try {
      const stateFilePath = path.join(this.dataPath, 'skill_state.json');

      // Get all enabled skill IDs
      const enabledIds = this.skillLists
        .flatMap((skillList) => skillList.skills)
        .filter(
          (skill) =>
            skill.checkboxState === vscode.TreeItemCheckboxState.Checked,
        )
        .map((skill) => skill.id);

      const stateData: SkillStateData = {
        enabledSkillIds: Array.from(enabledIds),
        lastUpdated: Date.now(),
      };

      fs.writeFileSync(stateFilePath, JSON.stringify(stateData, null, 2));
      console.log('Skill state saved successfully');
    } catch (error) {
      console.error('Error saving skill state:', error);
    }
  }

  // Load skills from storage
  private loadSkillsFromStorage(): void {
    try {
      const skillsDataPath = path.join(this.dataPath, 'skills_data.json');

      if (fs.existsSync(skillsDataPath)) {
        const storedData = JSON.parse(
          fs.readFileSync(skillsDataPath, 'utf8'),
        ) as StoredSkillData;

        // Create skill lists with the same structure as when loading remotely
        this.skillLists = storedData.skillLists.map((listData) => {
          const skillList = new SkillList(
            listData.label,
            listData.realmUrl,
            listData.readOnly,
          );

          // Convert stored skills to Skill objects with proper state
          skillList.skills = listData.skills.map((skillData) => {
            const skill = new Skill(
              skillData.label,
              skillData.instructions,
              skillData.id,
            );

            // Set the checkbox state based on the stored enabled state
            skill.checkboxState = this.enabledSkillIds.has(skillData.id)
              ? vscode.TreeItemCheckboxState.Checked
              : vscode.TreeItemCheckboxState.Unchecked;

            return skill;
          });

          return skillList;
        });

        this._onDidChangeTreeData.fire();

        console.log('Loaded skills from storage successfully');
      }
    } catch (error) {
      console.error('Error loading skills from storage:', error);
    }
  }

  // Load just the skill state (enabled/disabled)
  private loadSkillState(): void {
    try {
      const stateFilePath = path.join(this.dataPath, 'skill_state.json');

      if (fs.existsSync(stateFilePath)) {
        const stateData = JSON.parse(
          fs.readFileSync(stateFilePath, 'utf8'),
        ) as SkillStateData;

        // Load enabled skill IDs into the set
        this.enabledSkillIds = new Set(stateData.enabledSkillIds);
        console.log('Loaded skill state successfully', this.enabledSkillIds);
      }
    } catch (error) {
      console.error('Error loading skill state:', error);
    }
  }

  async refresh(): Promise<void> {
    const realmUrls = await this.realmAuth.getRealmUrls();
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Loading all skills from realms',
        cancellable: false,
      },
      async (progress) => {
        this.skillLists = [
          new SkillList('Base', 'https://app.boxel.ai/base/', true),
          new SkillList('Catalog', 'https://app.boxel.ai/catalog/', true),
          new SkillList('Skills', 'https://app.boxel.ai/skills/', true),
        ];
        this.skillLists.push(
          ...realmUrls.map((url) => new SkillList(url, url)),
        );

        const total = this.skillLists.length;
        let completed = 0;

        const loadingPromises = this.skillLists.map((skillList) =>
          skillList.loadSkills(this.realmAuth).then(() => {
            completed++;
            progress.report({
              message: `Loaded ${completed}/${total} realms`,
              increment: (1 / total) * 100,
            });
          }),
        );

        const results = await Promise.allSettled(loadingPromises);

        // Log any failed realm loads
        results.forEach((result, index) => {
          if (result.status === 'rejected') {
            console.error(
              `Failed to load ${this.skillLists[index].label}:`,
              result.reason,
            );
          }
        });

        // After loading, restore enabled/disabled state from storage
        this.restoreSkillsState();

        // Save new skills data to storage, but don't change enabled state
        this.saveSkillsToStorage();
      },
    );
    this._onDidChangeTreeData.fire();
  }

  // Restore skill enabled/disabled state
  private restoreSkillsState(): void {
    for (const skillList of this.skillLists) {
      for (const skill of skillList.skills) {
        skill.checkboxState = this.enabledSkillIds.has(skill.id)
          ? vscode.TreeItemCheckboxState.Checked
          : vscode.TreeItemCheckboxState.Unchecked;
      }
    }
  }

  getTreeItem(element: Skill): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillList): Promise<vscode.TreeItem[]> {
    if (!element) {
      //No element means we are at the root
      return Promise.resolve(this.skillLists);
    } else {
      // return children of the skill list
      return Promise.resolve(element.getChildren());
    }
  }

  // Handle tree item checkbox state change
  public handleTreeItemCheckboxChange(element: Skill): void {
    console.log(`Checkbox state changed for skill: ${element.label}`);

    // Update enabled skills set
    if (element.checkboxState === vscode.TreeItemCheckboxState.Checked) {
      this.enabledSkillIds.add(element.id);
    } else {
      this.enabledSkillIds.delete(element.id);
    }

    // Save just the state (not the full skill data)
    this.saveSkillState();

    // Update .cursorrules file
    this.updateCursorRules();
  }
}

export class Skill extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly instructions: string,
    public readonly id: string,
  ) {
    super(label);
    this.checkboxState = vscode.TreeItemCheckboxState.Unchecked;
  }
  getChildren(_element?: SkillList): Thenable<Skill[]> {
    return Promise.resolve([]);
  }
}

export class SkillList extends vscode.TreeItem {
  skills: Skill[] = [];

  constructor(
    public readonly label: string,
    public readonly realmUrl: string,
    public readonly readOnly: boolean = false,
  ) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  getChildren(_element?: Skill): Skill[] {
    return this.skills;
  }

  async loadSkills(realmAuth: RealmAuth): Promise<void> {
    let headers: Record<string, string> = {
      Accept: 'application/vnd.card+json',
    };
    if (!this.readOnly) {
      let jwt = await realmAuth.getJWT(this.realmUrl);
      if (!jwt) {
        throw new Error(`No JWT found for realm ${this.realmUrl}`);
      }
      headers['Authorization'] = jwt;
    }

    const searchUrl = new URL('./_search', this.realmUrl);

    // Update search parameters to match the example URL
    searchUrl.searchParams.set(
      'sort[0][on][module]',
      'https://cardstack.com/base/card-api',
    );
    searchUrl.searchParams.set('sort[0][on][name]', 'CardDef');
    searchUrl.searchParams.set('sort[0][by]', 'title');
    searchUrl.searchParams.set(
      'filter[type][module]',
      'https://cardstack.com/base/skill',
    );
    searchUrl.searchParams.set('filter[type][name]', 'Skill');

    const response = await fetch(searchUrl, {
      headers,
    });

    if (!response.ok) {
      console.log(
        'Response not ok:',
        response.status,
        response.statusText,
        response.body,
      );
    }

    const data: any = await response.json();
    console.log('Skill search data:', data);

    this.skills = data.data.map((skill: any) => {
      return new Skill(
        skill.attributes.title,
        skill.attributes.instructions,
        skill.id,
      );
    });
  }
}
