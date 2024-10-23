import * as vscode from 'vscode';
import { RealmAuth } from './realm-auth';

export class SkillsProvider
  implements vscode.TreeDataProvider<vscode.TreeItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    vscode.TreeItem | undefined | null | void
  > = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<
    vscode.TreeItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }
  constructor(private realmAuth: RealmAuth) {}

  getTreeItem(element: Skill): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillList): Promise<vscode.TreeItem[]> {
    if (!element) {
      //return skill lists
      const realmUrls = await this.realmAuth.getRealmUrls();
      return Promise.resolve(realmUrls.map((url) => new SkillList(url, url)));
    } else {
      // return children of the skill list
      return Promise.resolve(element.getChildren());
    }
  }
}

class Skill extends vscode.TreeItem {
  constructor(public readonly label: string) {
    super(label);
    // Check in (global?) kv store if this is checked or not
    // default to 'no'
    this.checkboxState = vscode.TreeItemCheckboxState.Checked;
  }
  getChildren(element?: SkillList): Thenable<Skill[]> {
    return Promise.resolve([]);
  }
}

class SkillList extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly realmUrl: string,
  ) {
    super(label);
    this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
  }

  getChildren(element?: Skill): Thenable<Skill[]> {
    // return demo skills
    return Promise.resolve([
      new Skill('Demo Skill 1'),
      new Skill('Demo Skill 2'),
    ]);
  }
}
