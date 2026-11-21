Skyrim Modding Tools - MCP Server: the installer
================================================

These installers fetch the newest version of the server from GitHub
(https://github.com/Ciltress/skyrim-modding-tools-mcp) and set it up. Run one again
whenever a new version is out: it updates the server where it is, and keeps your
settings and your projects.

Windows
-------
Double-click "Install on Windows.cmd". If Windows asks whether to run it, choose Run
(on a blue SmartScreen window: More info, then Run anyway).

Linux
-----
Open a terminal in this folder and run:

    bash install-linux.sh

What they do
------------
1. Install git and Node.js where they are missing, after asking you: with winget on
   Windows; on Linux with pacman on Arch and its kin, or else Node.js 24 from
   nodejs.org into ~/.local, for you alone.
2. Download the server into your user folder, skyrim-modding-tools-mcp, or update
   it there. Another folder: -Dir <folder> on Windows, --dir <folder> on Linux.
3. Run its setup, which installs the .NET 10 SDK, builds the server, finds your mod
   manager (Mod Organizer 2 on Windows, Amethyst on Linux), registers the server with
   Claude Code, Claude Desktop and VS Code, sets up Muddy, the modding agent, and
   ends with a health check. It asks before it installs or registers anything.

Then restart your MCP client, so it starts the new version.

Please start on a test instance: deploying and installing write into your mod
manager's mods and profile.
