# Boxel Tools VS Code Extension

This extension allows you to interact with Boxel workspaces from VS Code and Cursor.

## Installation

The extension is available through the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cardstack.boxel-tools).

You can also build it [locally](#development).

## Usage

### Getting Started

1. Install the extension from the VS Code Marketplace or [build it locally](#development).
2. Open a new window and in the command palette (F1 or Ctrl+Shift+P), select "Boxel Tools: Attach to Boxel Workspaces".
3. You will be prompted to log in to your Boxel account:
   - Enter your username and password
   - If you want to use a different server, change the server URL in VS Code settings

### Connecting to Boxel Workspaces

After logging in, the extension will automatically discover and list all your Boxel workspaces in the "Boxel" view in the Explorer sidebar. For each workspace, you can:

- **Pull workspace files**: Click the download icon next to a workspace to download all files to your local machine
- **Push local changes**: Click the upload icon to push any local changes back to the remote workspace
- **Enable file watching**: Toggle automatic syncing of changes by clicking the "eye" icon

To add the Boxel workspaces to your VSCode workspace, use the + button in the Boxel view or the command "Add Boxel Workspaces Folder to Workspace".

### Working with Workspace Files

Once you've downloaded workspace files:

1. Navigate to the files in your Explorer view
2. Edit files as you normally would in VS Code
3. If file watching is enabled, local changes will automatically sync to the remote workspace. Changes remotely will *not* automatically sync back.
4. Otherwise, manually push changes using the upload icon in the Boxel Workspaces view

### Managing Coding Skills

The extension includes a Skills Manager that allows you to enable various coding assistants:

1. Find the "Boxel" view in the Explorer sidebar
2. Browse available skills grouped by source (Base, Catalog, or your custom workspaces)
3. Check the checkbox next to skills you want to enable
4. Enabled skills will be applied to your editing experience automatically

Skills are stored in two locations:
- Skill definitions are saved in your user folder
- The enabled/disabled state is saved separately to persist across refreshes

### Useful Commands

Access these commands through the command palette (F1 or Ctrl+Shift+P):

- **Boxel Tools: Attach to Boxel Workspaces**: Discovers and lists all your workspaces
- **Boxel Tools: Log in**: Manually trigger the login process
- **Boxel Tools: Check Server Connection**: Verify your connection to the server
- **Boxel Tools: Add Workspaces Folder to Workspace**: Add the Boxel workspace folder to your VS Code workspace
- **Boxel Tools: Reload Skills**: Refresh the list of available coding skills

### Troubleshooting

If you encounter issues:

- **Connection problems**: Use "Check Server Connection" command to test your connection
- **Authentication errors**: Check your username and password; be aware of rate limits on the server
- **Sync issues**: Ensure you have proper permissions for the workspace you're trying to access
- **Skills not working**: Try reloading skills or check if the `.cursorrules` file exists in your user folder

For further assistance, check the [extension repository](https://github.com/cardstack/boxel) or file an issue.

## Development

This project uses mise for toolchain management and pnpm for package management.

Install dependencies with pnpm:

```bash
pnpm install
```

Build a dependent package, from `/packages/boxel-ui/addon`:

```bash
pnpm build
```

Build the extension, from `/packages/vscode-boxel-tools`:

```bash
pnpm run vscode:package
```

### Installation

Open VS Code and drag the created `.vsix` file into the VS Code extensions list.

### Debugging

When developing in VS Code you can hit F5 and the extension will be run in a VS Code dev environment, with debugging available.

## Troubleshooting

If you are seeing errors, a common one is a mistake with the username or password, and then hitting the tight rate limits on the server.
