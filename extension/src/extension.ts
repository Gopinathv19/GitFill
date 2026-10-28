import * as vscode from "vscode";
import { GitFillClient, type ExplainResponse } from "./client";
import { applyDriftFindings, previewAndApplyDocComments, registerPreviewProvider } from "./docs";
import { Git } from "./git";
import { ResultPanel } from "./panel";
import { collectWorkspace, relativePath } from "./workspace";

/**
 * GitFill for VS Code: explanations with sources and diagrams, documentation comments
 * with preview, and analysis of local changes and commits. Read-only except for the
 * explicit Apply actions; the server receives only the files relevant to each request.
 */
export function activate(context: vscode.ExtensionContext) {
  registerPreviewProvider(context);
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  status.command = "gitfill.askRepository";
  status.text = "$(book) GitFill";
  status.tooltip = "Ask GitFill about this repository";
  status.show();
  context.subscriptions.push(status);

  const register = (command: string, fn: (...args: unknown[]) => Promise<void>) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(command, async (...args: unknown[]) => {
        try {
          await fn(...args);
        } catch (err) {
          void vscode.window.showErrorMessage(`GitFill: ${err instanceof Error ? err.message : String(err)}`);
        }
      }),
    );

  register("gitfill.signIn", () => signIn(context));
  register("gitfill.signOut", async () => {
    await context.secrets.delete("gitfill.token");
    void vscode.window.showInformationMessage("GitFill: signed out.");
  });

  register("gitfill.explainSelection", async () => {
    const editor = requireEditor();
    const folder = requireFolder(editor.document.uri);
    const client = await requireClient(context);
    const selection = editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection);
    const path = relativePath(folder, editor.document.uri);
    const startLine = editor.selection.start.line + 1;
    const endLine = editor.selection.end.line + 1;
    const question = await vscode.window.showInputBox({ title: "GitFill: Explain selected code", prompt: "What do you want to know? Leave empty for a general explanation.", placeHolder: "e.g. Why does this call process_payment() and what happens if it fails?" });
    if (question === undefined) return;
    await withProgress(context, "Explaining selection", async () => {
      const workspace = await collectWorkspace(folder, [path]);
      const res = await client.explain({
        question: question.trim() || `Explain what this code does, how it is used (callers), what it depends on, and what could go wrong. Selected lines ${startLine}-${endLine} of ${path}.`,
        workspace,
        focus: { path, startLine, endLine, selection },
      });
      ResultPanel.show(context, folder, { ...res, note: footnote(res) });
    });
  });

  register("gitfill.explainFile", async () => {
    const editor = requireEditor();
    const folder = requireFolder(editor.document.uri);
    const client = await requireClient(context);
    const path = relativePath(folder, editor.document.uri);
    await withProgress(context, `Explaining ${path}`, async () => {
      const workspace = await collectWorkspace(folder, [path]);
      const res = await client.explain({ question: `Explain the file ${path}: its purpose, each important declaration, what it imports and what imports it, and how it fits into the system. Include a diagram if the file coordinates several components.`, workspace, focus: { path } });
      ResultPanel.show(context, folder, { ...res, note: footnote(res) });
    });
  });

  register("gitfill.askRepository", async (preset?: unknown) => {
    const folder = requireFolder(vscode.window.activeTextEditor?.document.uri);
    const client = await requireClient(context);
    const question = typeof preset === "string" ? preset : await vscode.window.showInputBox({ title: "GitFill: Ask about this repository", prompt: "Ask how something works, what happens when…, where something lives, or how parts relate.", placeHolder: "e.g. What happens after a user clicks the login button?" });
    if (!question?.trim()) return;
    const active = vscode.window.activeTextEditor ? [relativePath(folder, vscode.window.activeTextEditor.document.uri)] : [];
    await withProgress(context, "Answering", async () => {
      const workspace = await collectWorkspace(folder, active, { limit: Math.max(60, vscode.workspace.getConfiguration("gitfill").get<number>("maxContextFiles") ?? 60) });
      const res = await client.explain({ question: question.trim(), workspace });
      ResultPanel.show(context, folder, { ...res, note: footnote(res) });
    });
  });

  register("gitfill.generateDiagram", async () => {
    const editor = requireEditor();
    const folder = requireFolder(editor.document.uri);
    const client = await requireClient(context);
    const kind = await vscode.window.showQuickPick(
      [
        { label: "Sequence diagram", description: "communication between components", value: "sequence" },
        { label: "Flowchart", description: "conditional logic or a business workflow", value: "flowchart" },
        { label: "Class diagram", description: "classes, methods and relationships", value: "class" },
        { label: "Component diagram", description: "the architecture around this code", value: "component" },
        { label: "Entity-relationship diagram", description: "database models and relations", value: "er" },
        { label: "Dependency graph", description: "how modules depend on each other", value: "dependency" },
      ],
      { title: "GitFill: Which diagram?" },
    );
    if (!kind) return;
    const path = relativePath(folder, editor.document.uri);
    const selection = editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection);
    await withProgress(context, `Drawing ${kind.label.toLowerCase()}`, async () => {
      const workspace = await collectWorkspace(folder, [path]);
      const res = await client.explain({ question: `Produce a ${kind.label.toLowerCase()} for ${selection ? "the selected code" : `the file ${path}`} and explain it briefly. Every node must correspond to real code.`, diagram: kind.value, workspace, focus: { path, startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1, selection } });
      ResultPanel.show(context, folder, { ...res, note: footnote(res) });
    });
  });

  register("gitfill.generateDocs", async () => {
    const editor = requireEditor();
    const client = await requireClient(context);
    const path = vscode.workspace.asRelativePath(editor.document.uri);
    const selection = editor.selection.isEmpty ? undefined : { startLine: editor.selection.start.line + 1, endLine: editor.selection.end.line + 1 };
    await withProgress(context, `Documenting ${path}`, async () => {
      const res = await client.document({ path, content: editor.document.getText(), selection });
      await previewAndApplyDocComments(editor, res);
    });
  });

  register("gitfill.explainWorkingChanges", () => explainDiff(context, "working"));
  register("gitfill.explainStagedChanges", () => explainDiff(context, "staged"));

  register("gitfill.compareLocalCommits", async () => {
    const folder = requireFolder(vscode.window.activeTextEditor?.document.uri);
    const client = await requireClient(context);
    const git = new Git(folder.uri.fsPath);
    if (!(await git.isRepo())) throw new Error("This folder is not a git repository.");
    const [log, branches] = await Promise.all([git.log(60), git.branches()]);
    const items = [
      ...branches.map((b) => ({ label: `$(git-branch) ${b}`, ref: b })),
      ...log.map((c) => ({ label: `$(git-commit) ${c.sha.slice(0, 7)} ${c.subject}`, description: `${c.author} · ${c.date}`, ref: c.sha })),
    ];
    const head = await vscode.window.showQuickPick(items, { title: "GitFill: pick the NEWER commit or branch (head)", matchOnDescription: true });
    if (!head) return;
    const base = await vscode.window.showQuickPick(items.filter((i) => i.ref !== head.ref), { title: "GitFill: pick the OLDER commit or branch (base)", matchOnDescription: true });
    if (!base) return;
    await withProgress(context, `Comparing ${base.ref.slice(0, 7)}..${head.ref.slice(0, 7)}`, async () => {
      const diff = await git.rangeDiff(base.ref, head.ref);
      if (!diff.trim()) throw new Error("No differences between the two refs.");
      const paths = await git.changedPaths(diff);
      const workspace = await collectWorkspace(folder, paths);
      const res = await client.changes({ workspace, diff, scope: `${base.ref}..${head.ref}`, question: "Explain what changed between these commits at the architectural and structural level and its impact: moved responsibilities, new layers or dependencies, changed interfaces, affected tests, risks. Separate measured facts from hypotheses about intent." });
      ResultPanel.show(context, folder, { ...res, note: `Local comparison ${base.ref.slice(0, 12)} → ${head.ref.slice(0, 12)}. ${footnote(res)}` });
    });
  });

  register("gitfill.checkReadmeDrift", async () => {
    const folder = requireFolder(vscode.window.activeTextEditor?.document.uri);
    const client = await requireClient(context);
    const git = new Git(folder.uri.fsPath);
    if (!(await git.isRepo())) throw new Error("This folder is not a git repository.");
    const candidates = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, "**/README.md"), "**/node_modules/**", 20);
    const active = vscode.window.activeTextEditor?.document;
    const target = active?.fileName.toLowerCase().endsWith(".md") ? active.uri : candidates.length === 1 ? candidates[0]! : await pickUri(candidates);
    if (!target) return;
    await withProgress(context, "Checking documentation drift", async () => {
      const diff = await git.workingTreeDiff();
      if (!diff.trim()) throw new Error("No working-tree changes to compare against.");
      const document = (await vscode.workspace.openTextDocument(target)).getText();
      const res = await client.drift({ documentName: vscode.workspace.asRelativePath(target), document, changes: diff });
      await applyDriftFindings(target, res);
    });
  });
}

export function deactivate() {}

async function explainDiff(context: vscode.ExtensionContext, mode: "working" | "staged") {
  const folder = requireFolder(vscode.window.activeTextEditor?.document.uri);
  const client = await requireClient(context);
  const git = new Git(folder.uri.fsPath);
  if (!(await git.isRepo())) throw new Error("This folder is not a git repository.");
  await withProgress(context, mode === "working" ? "Explaining working-tree changes" : "Explaining staged changes", async () => {
    const diff = mode === "working" ? await git.workingTreeDiff() : await git.stagedDiff();
    if (!diff.trim()) throw new Error(mode === "working" ? "The working tree has no changes." : "Nothing is staged.");
    const paths = await git.changedPaths(diff);
    const workspace = await collectWorkspace(folder, paths);
    const res = await client.changes({ workspace, diff, scope: mode === "working" ? "working tree (staged, unstaged and untracked) vs HEAD" : "staged changes vs HEAD" });
    ResultPanel.show(context, folder, { ...res, note: footnote(res) });
  });
}

async function signIn(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("gitfill");
  const serverUrl = await vscode.window.showInputBox({ title: "GitFill server URL", value: config.get<string>("serverUrl") ?? "http://localhost:3000", prompt: "Where the GitFill web app runs." });
  if (!serverUrl) return;
  await config.update("serverUrl", serverUrl.replace(/\/+$/, ""), vscode.ConfigurationTarget.Global);
  const token = await vscode.window.showInputBox({ title: "GitFill API token", prompt: "Create one in the web app under Settings → VS Code extension.", password: true, placeHolder: "gf_…", validateInput: (v) => (/^gf_[0-9a-f]{48}$/.test(v.trim()) ? null : "Tokens look like gf_ followed by 48 hex characters.") });
  if (!token) return;
  await context.secrets.store("gitfill.token", token.trim());
  const client = (await GitFillClient.fromContext(context))!;
  const me = await client.me();
  void vscode.window.showInformationMessage(`GitFill: signed in as ${me.user.login}.${me.modelConfigured ? "" : " The server has no model key yet; ask the admin to set MODEL_API_KEY."}`);
}

async function requireClient(context: vscode.ExtensionContext): Promise<GitFillClient> {
  const client = await GitFillClient.fromContext(context);
  if (client) return client;
  const choice = await vscode.window.showInformationMessage("GitFill needs a server URL and an API token.", "Sign in");
  if (choice === "Sign in") await signIn(context);
  const after = await GitFillClient.fromContext(context);
  if (!after) throw new Error("Not signed in.");
  return after;
}

function requireEditor(): vscode.TextEditor {
  const editor = vscode.window.activeTextEditor;
  if (!editor) throw new Error("Open a file first.");
  return editor;
}

function requireFolder(uri: vscode.Uri | undefined): vscode.WorkspaceFolder {
  const folder = (uri && vscode.workspace.getWorkspaceFolder(uri)) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) throw new Error("Open a folder first.");
  return folder;
}

async function pickUri(uris: vscode.Uri[]): Promise<vscode.Uri | undefined> {
  if (!uris.length) throw new Error("No README.md found in this workspace.");
  const pick = await vscode.window.showQuickPick(uris.map((u) => ({ label: vscode.workspace.asRelativePath(u), uri: u })), { title: "GitFill: which document?" });
  return pick?.uri;
}

async function withProgress(context: vscode.ExtensionContext, title: string, fn: () => Promise<void>) {
  ResultPanel.busy(context, title);
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `GitFill: ${title}…`, cancellable: false }, fn);
}

function footnote(res: ExplainResponse): string {
  return `${res.filesAnalyzed} workspace file(s) were analyzed. Statements marked verified were checked against the code by GitFill; unverified items are listed below the answer.`;
}
