# Boxel Tools VS Code Extension

This extension allows you to interact with Boxel workspaces from VS Code.

## Features

- Open files in your Boxel workspace
- Create new files in your Boxel workspace
- Edit files in your Boxel workspace
- Delete files in your Boxel workspace

## Installation

The extension is available through the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=cardstack.boxel-tools).

You can also build it [locally](#development).

## Usage

Open a new window and in the command palette select "boxelrealm: Setup Workspace".

You will be prompted for your username and password for production. If you want to use another environment, alter the Matrix Server in VS Code settings.

The realm should then be viewable as a folder in your workspace.

## Development

This project uses Volta for toolchain management and pnpm for package management.

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

If you are seeing errors, a common one is a mistake with the username or password, and then hitting the tight rate limits on the Matrix server.
