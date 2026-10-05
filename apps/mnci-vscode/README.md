# MNCI for VS Code

The [MoNecromanCI](https://github.com/MoNecromanCI/MoNecromanCi) CLI, in your editor. Create a workspace, add projects in any of five languages, check the workspace and keep it up to date, from a side bar or the command palette, without remembering the flags.

The extension does not reimplement anything. It asks the `mnci` CLI what it can do and runs it, so it stays in step with the CLI you have installed.

## The side bar

Click the MNCI icon in the activity bar.

- **Commands**: every mnci command, grouped (Workspace, Projects, Dependencies, Pipeline). Click one and you are asked for what it needs.
- **Projects**: the projects of the open workspace, each with its targets. Click a target to run it.
- **Update**: the installed mnci version, whether a newer one exists, and one click to update.

## Commands

Every command is also in the palette (`Ctrl+Shift+P`), under **MNCI**.

| Command | What it does |
|---|---|
| New workspace | Creates a monorepo in a folder you choose |
| Upgrade this workspace | Re-applies the latest mnci configuration |
| Doctor | Checks the workspace and lists what is wrong in the **Problems** panel, each with its fix |
| Add project | Pick a kind (grouped by language) and a name; only the options that apply to that kind are offered |
| Install dependencies | Add packages to the projects you pick, using each project's own toolchain |
| Sync dependency versions | Make every project agree on one version of each dependency |
| Update dependencies | Show newer releases and apply the ones you choose |
| Run a CI phase | Run a phase of the pipeline here, as CI runs it |
| Run a project target | Run `nx run <project>:<target>` |
| Update mnci | Update the CLI, after showing you the exact command |

Commands run in the integrated **MNCI** terminal, so you see what ran and can answer any prompt.

## Which mnci does it use?

In this order: the `mnci.cliPath` setting; the workspace's own install (`node_modules/.bin`), which is the version the workspace was built with; a global install; and last `npx @mnci/cli`, which needs the network.

## Settings

| Setting | Meaning |
|---|---|
| `mnci.cliPath` | Path to the `mnci` executable. Leave empty to find it as above. |

## Requirements

Node.js. Everything else mnci needs is described in its own documentation.

## Links

[MoNecromanCI on GitHub](https://github.com/MoNecromanCI/MoNecromanCi) · [Report an issue](https://github.com/MoNecromanCI/MoNecromanCi/issues)
