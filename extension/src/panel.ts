import * as vscode from "vscode";
import type { Reference } from "./client";

/**
 * The GitFill results panel: renders Markdown (marked) and Mermaid in a webview, lists
 * sources as clickable file:line links, and offers follow-up actions.
 */
export class ResultPanel {
  private static current: ResultPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  static show(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder | undefined, result: { title: string; markdown: string; references?: Reference[]; unverified?: string[]; followUps?: string[]; note?: string }) {
    if (!ResultPanel.current) ResultPanel.current = new ResultPanel(context);
    ResultPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
    ResultPanel.current.render(folder, result);
  }

  static busy(context: vscode.ExtensionContext, title: string) {
    if (!ResultPanel.current) ResultPanel.current = new ResultPanel(context);
    ResultPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
    ResultPanel.current.panel.title = `GitFill: ${title}`;
    ResultPanel.current.panel.webview.html = html(ResultPanel.current.panel.webview, { title, markdown: "_Working… GitFill reads the relevant files and verifies every claim against the code._", references: [], unverified: [], followUps: [] });
  }

  private constructor(private readonly context: vscode.ExtensionContext) {
    this.panel = vscode.window.createWebviewPanel("gitfill.result", "GitFill", { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private render(folder: vscode.WorkspaceFolder | undefined, result: { title: string; markdown: string; references?: Reference[]; unverified?: string[]; followUps?: string[]; note?: string }) {
    this.panel.title = `GitFill: ${result.title}`.slice(0, 60);
    this.panel.webview.html = html(this.panel.webview, result);
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      async (msg: { type: string; path?: string; line?: number; question?: string }) => {
        if (msg.type === "open" && msg.path && folder) {
          const uri = vscode.Uri.joinPath(folder.uri, msg.path);
          const doc = await Promise.resolve(vscode.workspace.openTextDocument(uri)).catch(() => undefined);
          if (!doc) return void vscode.window.showWarningMessage(`GitFill: ${msg.path} is not in this workspace.`);
          const line = Math.max(0, (msg.line ?? 1) - 1);
          await vscode.window.showTextDocument(doc, { viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(line, 0, line, 0) });
        } else if (msg.type === "ask" && msg.question) {
          await vscode.commands.executeCommand("gitfill.askRepository", msg.question);
        } else if (msg.type === "copy") {
          await vscode.env.clipboard.writeText(result.markdown);
          void vscode.window.showInformationMessage("GitFill: Markdown copied.");
        }
      },
      null,
      this.disposables,
    );
  }

  private dispose() {
    ResultPanel.current = undefined;
    this.disposables.forEach((d) => d.dispose());
  }
}

function html(webview: vscode.Webview, r: { title: string; markdown: string; references?: Reference[]; unverified?: string[]; followUps?: string[]; note?: string }): string {
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const data = JSON.stringify({ markdown: r.markdown, references: r.references ?? [], unverified: r.unverified ?? [], followUps: r.followUps ?? [], note: r.note ?? "" }).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; font-src ${webview.cspSource} https:;">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(r.title)}</title>
<style>
  body { font-family: var(--vscode-font-family); font-size: 13px; line-height: 1.6; color: var(--vscode-foreground); padding: 0 18px 32px; }
  h1,h2,h3,h4 { line-height: 1.3; } h1 { font-size: 1.4em; } h2 { font-size: 1.15em; border-bottom: 1px solid var(--vscode-panel-border); padding-bottom: .2em; margin-top: 1.6em; } h3 { font-size: 1em; }
  code { font-family: var(--vscode-editor-font-family); font-size: .92em; background: var(--vscode-textCodeBlock-background); padding: .1em .3em; border-radius: 3px; }
  pre { background: var(--vscode-textCodeBlock-background); padding: .8em 1em; border-radius: 4px; overflow: auto; } pre code { background: none; padding: 0; }
  table { border-collapse: collapse; display: block; overflow: auto; } th, td { border: 1px solid var(--vscode-panel-border); padding: .3em .6em; text-align: left; vertical-align: top; }
  a { color: var(--vscode-textLink-foreground); }
  .toolbar { display: flex; gap: 8px; align-items: center; position: sticky; top: 0; background: var(--vscode-editor-background); padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); margin-bottom: 8px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 0; border-radius: 3px; padding: 4px 10px; cursor: pointer; font-size: 12px; } button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .ref { display: block; width: 100%; text-align: left; background: none; color: var(--vscode-textLink-foreground); padding: 2px 0; } .ref:hover { text-decoration: underline; background: none; }
  .muted { color: var(--vscode-descriptionForeground); }
  .mermaid { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; padding: 10px; overflow: auto; }
  .note { border-left: 3px solid var(--vscode-editorWarning-foreground); padding: .2em .8em; margin: .6em 0; }
  sub { color: var(--vscode-descriptionForeground); }
  .footnotes { font-size: .9em; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border); margin-top: 1.6em; padding-top: .6em; }
</style>
</head>
<body>
<div class="toolbar"><strong>GitFill</strong><span class="muted">${escapeHtml(r.title)}</span><span style="flex:1"></span><button id="copy">Copy Markdown</button></div>
<div id="note"></div>
<div id="content"></div>
<div id="refs"></div>
<div id="unverified"></div>
<div id="followups"></div>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/marked@15.0.12/marked.min.js"></script>
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/mermaid@11.12.0/dist/mermaid.min.js"></script>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const data = ${data};
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  if (data.note) document.getElementById('note').innerHTML = '<div class="note">' + esc(data.note) + '</div>';
  if (window.marked) {
    const renderer = new marked.Renderer();
    const base = renderer.code.bind(renderer);
    renderer.code = function (token) {
      const code = typeof token === 'string' ? token : token.text;
      const lang = typeof token === 'string' ? arguments[1] : token.lang;
      if (lang === 'mermaid') return '<pre class="mermaid">' + esc(code) + '</pre>';
      return base.apply(this, arguments);
    };
    document.getElementById('content').innerHTML = marked.parse(data.markdown, { renderer, gfm: true, breaks: false });
  } else {
    document.getElementById('content').innerHTML = '<pre>' + esc(data.markdown) + '</pre>';
  }
  if (window.mermaid) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'neutral' }); mermaid.run({ querySelector: '.mermaid' }).catch(() => {}); }
  if (data.references.length) {
    document.getElementById('refs').innerHTML = '<h3>Sources</h3>' + data.references.map((r, i) =>
      '<button class="ref" data-i="' + i + '"><code>' + esc(r.path) + ':' + r.startLine + (r.endLine !== r.startLine ? '-' + r.endLine : '') + '</code> — ' + esc(r.why) + '</button>').join('');
    document.querySelectorAll('.ref').forEach((b) => b.addEventListener('click', () => { const r = data.references[Number(b.dataset.i)]; vscode.postMessage({ type: 'open', path: r.path, line: r.startLine }); }));
  }
  if (data.unverified.length) document.getElementById('unverified').innerHTML = '<h3>Not verified in code</h3><ul>' + data.unverified.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ul>';
  if (data.followUps.length) {
    document.getElementById('followups').innerHTML = '<h3>Ask next</h3>' + data.followUps.map((q, i) => '<button class="ref" data-q="' + i + '">' + esc(q) + '</button>').join('');
    document.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => vscode.postMessage({ type: 'ask', question: data.followUps[Number(b.dataset.q)] })));
  }
  document.getElementById('copy').addEventListener('click', () => vscode.postMessage({ type: 'copy' }));
  document.querySelectorAll('#content a[href]').forEach((a) => { if (a.getAttribute('href').startsWith('http')) a.setAttribute('target', '_blank'); });
</script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}
