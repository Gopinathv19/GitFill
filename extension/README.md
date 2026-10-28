# GitFill for VS Code

Brings GitFill into the editor: explanations with sources and diagrams, documentation comments with a preview, and analysis of local changes and commits, including work that is not pushed yet.

| Command | What it does |
| --- | --- |
| GitFill: Explain selected code | Explains the selection, its callers and dependencies, with file:line sources |
| GitFill: Explain this file | Purpose, declarations, imports/importers, place in the system |
| GitFill: Ask a question about this repository | Natural-language question over the workspace |
| GitFill: Generate a diagram | Sequence, flowchart, class, component, ER or dependency diagram from real code |
| GitFill: Generate documentation comments (preview) | Doc comments for the selection or file; shown as a diff, applied only on Apply |
| GitFill: Explain working-tree / staged changes | What changed, why it matters, what could break, which tests are affected |
| GitFill: Compare two local commits or branches | Architectural comparison of any two local refs |
| GitFill: Check README against working-tree changes | Finds outdated statements and applies the fixes you pick |

## Setup

1. Run the GitFill web app and create an API token under **Settings → VS Code extension**.
2. In this folder: `npm install && npm run compile`, then press F5 in VS Code to launch an Extension Development Host (or `npm run package` to build a `.vsix` and install it).
3. Run **GitFill: Sign in**, enter the server URL and paste the token.

## What is sent to the server

Only the files relevant to the request (the active file and its neighbours first, up to `gitfill.maxContextFiles`), the git diff for change explanations, and the paths of other files for import resolution. Files matching `gitfill.excludeGlobs`, `.env*`, keys and lockfiles are never sent, and the server applies the same filters again. Nothing from the workspace is stored on the server.
