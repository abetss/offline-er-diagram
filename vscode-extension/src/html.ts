export function viewerHtml({ scriptUri, styleUri, cspSource, nonce }: {
  scriptUri: string;
  styleUri: string;
  cspSource: string;
  nonce: string;
}): string {
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
  const csp = `default-src 'none'; script-src 'nonce-${nonce}'; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:;`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="${escape(csp)}">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>DBML Diagram</title>
  <link rel="stylesheet" href="${escape(styleUri)}">
</head>
<body>
  <header class="toolbar" aria-label="Diagram controls">
    <button id="source" type="button">Edit source</button>
    <button id="fit" type="button">Fit</button>
    <button id="reset" type="button">Reset layout</button>
    <label><input id="notes" type="checkbox"> Notes</label>
    <button id="export" type="button" disabled>Export SVG</button>
    <span id="status" role="status" aria-live="polite">Loading DBML…</span>
  </header>
  <div id="error" role="alert" hidden></div>
  <main id="stage" aria-label="Database relationship diagram" tabindex="0"></main>
  <p id="empty" hidden>No tables in this DBML file. Use Edit source to add a table.</p>
  <footer>Drag tables to arrange. Drag the background to pan. Ctrl/Cmd + scroll to zoom. Double-click to fit.</footer>
  <script nonce="${escape(nonce)}" src="${escape(scriptUri)}"></script>
</body>
</html>`;
}
