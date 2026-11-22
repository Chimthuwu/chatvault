// ChatVault userscript UI. Inlined by scripts/build-userscript.mjs after the shared modules.
(() => {
  'use strict';
  if (window.__chatVaultV3Loaded) return;

  const host = location.hostname.toLowerCase();
  if (host === 'x.com' && !/grok/i.test(location.pathname)) return;
  if (host.endsWith('bing.com') && !/chat/i.test(location.pathname)) return;

  window.__chatVaultV3Loaded = true;
  const PREFIX = '[ChatVault]';

  const style = document.createElement('style');
  style.id = 'chatvault-style';
  style.textContent = `
    #cv3-toolbar {
      position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
      display: flex; gap: 6px; padding: 7px; border-radius: 13px;
      background: #101c1b; border: 1px solid #28544c; box-shadow: 0 8px 30px #0009;
      font-family: system-ui, sans-serif;
    }
    #cv3-toolbar button {
      padding: 10px 13px; border-radius: 8px; border: 1px solid #316b5c;
      background: #183b33; color: #70ffcf; font: 700 12px system-ui, sans-serif;
      cursor: pointer; white-space: nowrap;
    }
    #cv3-toolbar button:hover { background: #235548; }
    #cv3-toolbar button:disabled { opacity: .5; cursor: wait; }
    #cv3-toolbar #cv3-zip { background: #125747; border-color: #00dca5; }
    #cv3-toolbar #cv3-beautify { background: #3b2a63; border-color: #b39cff; color: #e2d6ff; }
    #cv3-status {
      position: fixed; right: 20px; bottom: 76px; z-index: 2147483000;
      max-width: 380px; padding: 11px 15px; border-radius: 9px;
      background: #111a1a; border: 1px solid #28544c; color: #9fffd9;
      font: 13px/1.5 system-ui, sans-serif; box-shadow: 0 8px 30px #0009;
      display: none; overflow-wrap: anywhere;
    }
  `;
  document.head.appendChild(style);

  const toolbar = document.createElement('div');
  toolbar.id = 'cv3-toolbar';
  const statusBox = document.createElement('div');
  statusBox.id = 'cv3-status';
  document.body.append(toolbar, statusBox);

  function status(message, error = false) {
    statusBox.textContent = message;
    statusBox.style.display = 'block';
    statusBox.style.color = error ? '#ffaaaa' : '#9fffd9';
    console[error ? 'error' : 'log'](PREFIX, message);
  }

  const buttons = {};
  for (const [key, label] of [
    ['beautify', '✨ BEAUTIFY'], ['md', '↓ MD'], ['pdf', '↓ PDF'],
    ['print', '🖨 PRINT'], ['html', '↓ HTML'], ['zip', '↓ ZIP']
  ]) {
    const button = document.createElement('button');
    button.id = 'cv3-' + key;
    button.textContent = label;
    if (key === 'zip') button.title = 'Markdown + PDF + HTML + JSON in one archive';
    buttons[key] = button;
    toolbar.appendChild(button);
  }

  async function beautifyCurrent() {
    status('Beautifying conversation…');
    const conv = await collectCurrentConversation();
    const result = beautifyConversation(conv);
    const base = slugify(conv.title);
    const pdfConv = toConversation({
      title: conv.title + ' (beautified)', source: conv.source,
      messages: [{ role: 'assistant', content: result.variants.report }],
      platform: conv.metadata?.platform, method: 'beautify'
    });
    const files = [
      { name: base + '.original.md', data: result.original },
      { name: base + '.clean.md', data: result.variants.clean },
      { name: base + '.report.md', data: result.variants.report },
      { name: base + '.knowledge-base.md', data: result.variants.kb },
      { name: base + '.intelligence-report.md', data: result.intelligenceReport },
      { name: base + '.editorial-prompt.md', data: result.editorialPrompt },
      { name: base + '.beautified.pdf', data: await blobBytes(makePdf(pdfConv)) }
    ];
    downloadBlob(await makeZip(files), base + '-beautified.zip');
    status(`✓ Beautified archive saved — ${files.length} files, original preserved.`);
  }

  async function run(format) {
    Object.values(buttons).forEach(b => { b.disabled = true; });
    try {
      if (format === 'beautify') return await beautifyCurrent();
      status('Extracting conversation…');
      const conv = await collectCurrentConversation();
      const base = slugify(conv.title);
      const markdown = renderMarkdown(conv);

      if (format === 'md') {
        downloadBlob(new Blob(['\uFEFF', markdown], { type: 'text/markdown;charset=utf-8' }), base + '.md');
        return status(`✓ Markdown saved — ${conv.messages.length} messages.`);
      }
      if (format === 'html') {
        downloadBlob(new Blob([renderHtml(conv)], { type: 'text/html;charset=utf-8' }), base + '.html');
        return status('✓ HTML archive saved.');
      }
      if (format === 'print') {
        openPrintWindow(renderHtml(conv, { print: true }));
        return status('✓ Print dialog opened. Choose “Save as PDF”.');
      }

      status('Building PDF…');
      const pdf = makePdf(conv);
      if (format === 'pdf') {
        downloadBlob(pdf, base + '.pdf');
        return status(`✓ PDF saved — ${(pdf.size / 1024).toFixed(0)} KB.`);
      }

      status('Building ZIP archive…');
      const [pdfBytes, htmlBytes, jsonBytes] = await Promise.all([
        blobBytes(pdf),
        blobBytes(new Blob([renderHtml(conv)], { type: 'text/html' })),
        blobBytes(new Blob([JSON.stringify(conv, null, 2)], { type: 'application/json' }))
      ]);
      downloadBlob(await makeZip([
        { name: base + '.md', data: markdown },
        { name: base + '.pdf', data: pdfBytes },
        { name: base + '.html', data: htmlBytes },
        { name: base + '.json', data: jsonBytes }
      ]), base + '.zip');
      status(`✓ ZIP saved with 4 files — ${conv.messages.length} messages.`);
    } catch (error) {
      console.error(PREFIX, error);
      status(error.message || 'Export failed. Check the console.', true);
    } finally {
      Object.values(buttons).forEach(b => { b.disabled = false; });
    }
  }

  for (const [key, button] of Object.entries(buttons)) button.addEventListener('click', () => run(key));
  console.log(PREFIX, 'v3 ready — BEAUTIFY / MD / PDF / PRINT / HTML / ZIP.');
})();
