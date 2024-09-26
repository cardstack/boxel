# Boxel Tools VS Code Extension

This extension allows you to interact with your Boxel Realm from VS Code.

## Features

- Open files in your Boxel Realm
- Create new files in your Boxel Realm
- Edit files in your Boxel Realm
- Delete files in your Boxel Realm

## Setup

This project uses volta for toolchain management, and pnpm for package management.

Install dependencies with pnpm:

```bash

pnpm install
```

Build the extension:

```bash
pnpm run vscode:package
```

## Installation

Open VS Code, and drag the created .vsix file into the VS Code extensions list.

## Usage

Open a new window and in the command pallet select "boxelrealm: Setup Workspace".

You will be prompted for your username and password for production (alter the matrix server url in vscode settings to use locally).

The realm should then be viewable as a folder in your workspace.

## Development

When developing in vscode you can hit F5 and the extension will be run in a vscode dev environment, with debugging available.

## Troubleshooting

If you are seeing errors, a common one is a mistake with the username or password, and then hitting the tight rate limits on the realm server.
