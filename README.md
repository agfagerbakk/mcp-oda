<h1>
  <p align="center">
    <a href="https://github.com/agfagerbakk/mcp-oda">
      <img src="mcp.svg" alt="Logo" height="128">
    </a>
    <br>mcp-oda
  </p>
</h1>

<p align="center">
  A Model Context Protocol (MCP) server for interacting with <a href="https://oda.com">oda.com</a>
</p>

> [!NOTE]
> This is a fork of [`gbbirkisson/mcp-oda`](https://github.com/gbbirkisson/mcp-oda), extended with
> delivery-slot support (and more). See the original repo for the upstream project.

<h2>Table of contents</h2>

<!-- vim-markdown-toc GFM -->

* [Features](#features)
* [Installation](#installation)
* [Usage](#usage)
  * [Initial Setup](#initial-setup)
  * [CLI Commands](#cli-commands)
  * [Configuration](#configuration)
    * [Claude Desktop](#claude-desktop)
    * [Claude Code](#claude-code)
    * [Gemini CLI](#gemini-cli)
* [Troubleshooting](#troubleshooting)
  * [Session not persisting](#session-not-persisting)

<!-- vim-markdown-toc -->

## Features

This MCP server provides tools to programmatically interact with Oda's grocery shopping platform:

- **Search products** - Search for groceries with support for Norwegian terms
- **Browse recipes** - Search, filter, and view recipe details
- **Manage shopping cart** - View cart contents, add/remove items, add recipe ingredients
- **Delivery slots** - List available delivery slots, select a slot, and list delivery addresses
- **Saved product lists** - Create, rename, delete, and manage Oda's saved lists ("Lister"),
  and add a whole list to the cart in one go
- **CLI access** - All operations available as CLI subcommands in addition to MCP tools
- **Session persistence** - Maintains login session across restarts

## Installation

This project requires Node.js (v18+).

## Usage

### Initial Setup

Authenticate with your Oda account:

```bash
npx github:agfagerbakk/mcp-oda auth login --user your@email.com --pass yourpassword
```

Verify your login status:

```bash
npx github:agfagerbakk/mcp-oda auth user
```

> [!NOTE]
> Session data is stored by default in `~/.mcp-oda`

### CLI Commands

Running `npx github:agfagerbakk/mcp-oda` with no arguments prints help. The `mcp` subcommand
starts the MCP server. All other operations are available as subcommands:

```bash
# Start the MCP server
npx github:agfagerbakk/mcp-oda mcp

# Products
npx github:agfagerbakk/mcp-oda product search melk
npx github:agfagerbakk/mcp-oda product search melk --page 2
npx github:agfagerbakk/mcp-oda product add 132

# Cart
npx github:agfagerbakk/mcp-oda cart list
npx github:agfagerbakk/mcp-oda cart remove 132
npx github:agfagerbakk/mcp-oda cart clear

# Delivery slots
npx github:agfagerbakk/mcp-oda slot list
npx github:agfagerbakk/mcp-oda slot list --num-days 7
npx github:agfagerbakk/mcp-oda slot list --from-index 4
npx github:agfagerbakk/mcp-oda slot select 1607524
npx github:agfagerbakk/mcp-oda slot select 1607524 --address 2541949
npx github:agfagerbakk/mcp-oda slot select 1607524 --unattended
npx github:agfagerbakk/mcp-oda slot addresses

# Recipes
npx github:agfagerbakk/mcp-oda recipe search pizza
npx github:agfagerbakk/mcp-oda recipe details 123
npx github:agfagerbakk/mcp-oda recipe add 123 --portions 4
npx github:agfagerbakk/mcp-oda recipe remove 123

# Saved product lists
npx github:agfagerbakk/mcp-oda list all
npx github:agfagerbakk/mcp-oda list get 442221
npx github:agfagerbakk/mcp-oda list create "Weekly essentials" --description "Stuff we always buy"
npx github:agfagerbakk/mcp-oda list rename 442221 --title "Essentials"
npx github:agfagerbakk/mcp-oda list delete 442221
npx github:agfagerbakk/mcp-oda list add 442221 132 --count 2
npx github:agfagerbakk/mcp-oda list remove 442221 132
npx github:agfagerbakk/mcp-oda list add-to-cart 442221

# Authentication
npx github:agfagerbakk/mcp-oda auth login --user your@email.com --pass yourpassword
npx github:agfagerbakk/mcp-oda auth logout
npx github:agfagerbakk/mcp-oda auth user

# Maintenance
npx github:agfagerbakk/mcp-oda clean
```

### Configuration

#### Claude Desktop
Claude Desktop configuration example:

```json
{
  "mcpServers": {
    "oda": {
      "command": "npx",
      "args": ["-y", "github:agfagerbakk/mcp-oda", "mcp"]
    }
  }
}
```

#### Claude Code

```bash
/plugin marketplace add agfagerbakk/mcp-oda
/plugin install mcp-oda@agfagerbakk/mcp-oda
```

#### Gemini CLI

```bash
gemini extensions install https://github.com/agfagerbakk/mcp-oda
```

## Troubleshooting

### Session not persisting

If your login session is not persisting between runs:

1. Try running with the `clean` subcommand to remove old session data:
   ```bash
   npx github:agfagerbakk/mcp-oda clean
   ```
2. Re-authenticate:
   ```bash
   npx github:agfagerbakk/mcp-oda auth login --user your@email.com --pass yourpassword
   ```
3. Make sure you're using the same `--data-dir` for all commands if you've overridden the default.
