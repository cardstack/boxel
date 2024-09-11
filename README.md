# Boxel VS Code Extension

This extension allows you to interact with your Boxel Realm from VS Code.

## Features

- Open files in your Boxel Realm
- Create new files in your Boxel Realm
- Edit files in your Boxel Realm
- Delete files in your Boxel Realm

## Setup

This project uses volta for toolchain management, and npm for package management.

Install dependencies with npm:

```bash

npm install
```

Build the extension:

```bash
npx vsce package
```

## Installation

Open VS Code, and drag the created .vsix file into the VS Code extensions list.

## Usage

Open a new window and set your username, password, realm url (not the realm server) and matrix server url in your user settings.
These are under extentions -> Boxel Realm -> Boxel Realm Settings.

Open a new window and in the command pallet select "boxelrealm: Setup Workspace".

The realm should then be viewable as a folder in your workspace.

## Development

When developing in vscode you can hit F5 and the extension will be run in a vscode dev environment, with debugging available.

## Troubleshooting

If you are seeing errors, a common one is a mistake with the username or password, and then hitting the tight rate limits on the realm server.
