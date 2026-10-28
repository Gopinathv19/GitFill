import * as vscode from "vscode";
import type { DocCommentsResponse, DriftResponse } from "./client";

/**
 * Preview → Apply/Reject flows. Nothing is written to a file until the user chooses Apply,
 * and everything goes through a WorkspaceEdit so it is a single undo step.
 */
const previews = new Map<string, string>();

const provider: vscode.TextDocumentContentProvider = {
  provideTextDocumentContent(uri) {
    return previews.get(uri.toString()) ?? "";
  },
};

export function registerPreviewProvider(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider("gitfill-preview", provider));
}

/** Shows a diff of the proposed comments and applies them on confirmation. */
export async function previewAndApplyDocComments(editor: vscode.TextEditor, result: DocCommentsResponse): Promise<void> {
  if (!result.comments.length) {
    void vscode.window.showInformationMessage(`GitFill: nothing to document.${result.skipped.length ? ` Skipped: ${result.skipped.slice(0, 3).join("; ")}` : ""}`);
    return;
  }
  const original = editor.document;
  const previewUri = vscode.Uri.parse(`gitfill-preview:${original.uri.path}?${Date.now()}`);
  previews.set(previewUri.toString(), result.preview);
  await vscode.commands.executeCommand("vscode.diff", original.uri, previewUri, `GitFill: ${result.comments.length} documentation comment(s) · ${vscode.workspace.asRelativePath(original.uri)}`);

  const choice = await vscode.window.showInformationMessage(`GitFill proposes ${result.comments.length} comment(s) for ${vscode.workspace.asRelativePath(original.uri)}.`, { modal: false }, "Apply", "Reject");
  previews.delete(previewUri.toString());
  if (choice !== "Apply") return;

  // Insert bottom-up so earlier line numbers stay valid; the server's preview used the same rule.
  const edit = new vscode.WorkspaceEdit();
  for (const c of [...result.comments].sort((a, b) => b.insertBeforeLine - a.insertBeforeLine)) {
    const line = Math.min(Math.max(c.insertBeforeLine - 1, 0), original.lineCount);
    edit.insert(original.uri, new vscode.Position(line, 0), `${c.text}\n`);
  }
  const ok = await vscode.workspace.applyEdit(edit);
  void vscode.window.showInformationMessage(ok ? `GitFill: applied ${result.comments.length} comment(s). Undo reverts them all.` : "GitFill: could not apply the edit.");
}

/** Lets the user pick which README fixes to apply, then replaces the quoted text in place. */
export async function applyDriftFindings(uri: vscode.Uri, result: DriftResponse): Promise<void> {
  if (!result.findings.length) {
    void vscode.window.showInformationMessage(`GitFill: ${vscode.workspace.asRelativePath(uri)} looks consistent with the changes.${result.missing.length ? ` Not covered yet: ${result.missing.slice(0, 2).join("; ")}` : ""}`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    result.findings.map((f, i) => ({ label: `${f.confidence === "high" ? "$(check)" : f.confidence === "medium" ? "$(question)" : "$(circle-outline)"} ${f.issue}`, detail: `“${f.original.slice(0, 120)}” → “${(f.proposed || "(delete)").slice(0, 120)}”`, picked: f.confidence !== "low", index: i })),
    { canPickMany: true, title: "GitFill: outdated statements found. Select the fixes to apply." },
  );
  if (!picked?.length) return;
  const doc = await vscode.workspace.openTextDocument(uri);
  const text = doc.getText();
  const edit = new vscode.WorkspaceEdit();
  let applied = 0;
  for (const p of picked) {
    const f = result.findings[p.index]!;
    const at = text.indexOf(f.original);
    if (at < 0) continue;
    edit.replace(uri, new vscode.Range(doc.positionAt(at), doc.positionAt(at + f.original.length)), f.proposed);
    applied++;
  }
  await vscode.workspace.applyEdit(edit);
  await vscode.window.showTextDocument(doc, { preview: false });
  void vscode.window.showInformationMessage(`GitFill: applied ${applied} documentation fix(es).`);
}
