// ChatVault userscript UI. Inlined by scripts/build-userscript.mjs after the shared modules.
(() => {
  'use strict';
  if (window.__chatVaultV3Loaded) return;

  window.__chatVaultV3Loaded = true;
  const host = location.hostname.toLowerCase();
  const isChatVaultOrigin = location.hostname === 'chat-vault.pages.dev' ||
    location.hostname.endsWith('.chat-vault.pages.dev') ||
    location.hostname === 'chatvault.nyan-anonymous-d45.workers.dev';
  const REQUEST_KEY = 'chatvault:browser-extract-request';
  const isExtractionTarget = (target, platform) =>
    platform.share.test(target.pathname) ||
    (platform.id === 'chatgpt' && /^\\/c\\/[A-Za-z0-9_-]+\\/?$/.test(target.pathname));
  const RESULT_KEY = 'chatvault:browser-extract-result';

  // ChatVault tab: queue extraction, then receive the result after same-tab return.
  if (isChatVaultOrigin) {
    if (typeof GM_addValueChangeListener !== 'function' || typeof GM_setValue !== 'function' ||
        typeof GM_getValue !== 'function') {
      console.warn('[ChatVault] Browser JSON handoff requires Tampermonkey GM storage permissions.');
      return;
    }
    const relayResult = result => {
      if (!result || !result.token) return;
      window.postMessage(Object.assign({ type: 'chatvault:browser-extract-result' }, result), location.origin);
      Promise.resolve(GM_setValue(RESULT_KEY, null)).catch(error =>
        console.warn('[ChatVault] Could not clear transfer result:', error));
    };
    GM_addValueChangeListener(RESULT_KEY, (_key, _oldValue, result) => relayResult(result));
    const returnToken = new URLSearchParams(location.hash.slice(1)).get('cv-return');
    if (returnToken) {
      Promise.resolve(GM_getValue(RESULT_KEY)).then(result => {
        if (result && result.token === returnToken) relayResult(result);
      }).catch(error => console.warn('[ChatVault] Could not read returned extraction:', error));
    }
    window.addEventListener('message', async event => {
      if (event.origin !== location.origin) return;
      const request = event.data;
      if (!request || request.type !== 'chatvault:browser-extract-request' ||
          typeof request.token !== 'string' || typeof request.url !== 'string' ||
          typeof request.returnUrl !== 'string') return;
      let target, returnTarget;
      try { target = new URL(request.url); returnTarget = new URL(request.returnUrl); } catch { return; }
      const platform = platformForHost(target.hostname);
      if (target.protocol !== 'https:' || target.username || target.password ||
          (target.port && target.port !== '443') || !platform ||
          !isExtractionTarget(target, platform) || returnTarget.origin !== location.origin ||
          new URLSearchParams(returnTarget.hash.slice(1)).get('cv-return') !== request.token) return;
      try {
        await Promise.resolve(GM_setValue(REQUEST_KEY, {
          token: request.token, url: target.href, returnUrl: returnTarget.href,
          expiresAt: Date.now() + 120000
        }));
        window.postMessage({ type: 'chatvault:browser-extract-started', token: request.token }, location.origin);
      } catch (error) {
        window.postMessage({
          type: 'chatvault:browser-extract-result', token: request.token,
          success: false, error: error && error.message || 'Could not queue browser extraction.'
        }, location.origin);
      }
    });
    return;
  }

  if (host === 'x.com' && !/grok/i.test(location.pathname)) return;
  if (host.endsWith('bing.com') && !/chat/i.test(location.pathname)) return;

  // Provider tab: match the requested public share and return a normalized conversation.
  if (typeof GM_addValueChangeListener === 'function' &&
      typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
    const processingRequests = new Set();
    async function processBrowserRequest(request) {
      if (!request || !request.token || !request.url || !request.returnUrl ||
          Number(request.expiresAt) < Date.now() || processingRequests.has(request.token)) return;
      let target, returnTarget;
      try { target = new URL(request.url); returnTarget = new URL(request.returnUrl); } catch { return; }
      const allowedReturnHost = returnTarget.hostname === 'chat-vault.pages.dev' ||
        returnTarget.hostname.endsWith('.chat-vault.pages.dev') ||
        returnTarget.hostname === 'chatvault.nyan-anonymous-d45.workers.dev';
      const requestedPlatform = platformForHost(target.hostname);
      const pagePlatform = detectPagePlatform();
      const requestedId = target.pathname.split('/').filter(Boolean).pop();
      const pageId = location.pathname.split('/').filter(Boolean).pop();
      if (!allowedReturnHost || returnTarget.protocol !== 'https:' ||
          new URLSearchParams(returnTarget.hash.slice(1)).get('cv-return') !== request.token ||
          !requestedPlatform || requestedPlatform.id !== pagePlatform.id ||
          !isExtractionTarget(target, requestedPlatform) || !requestedId || requestedId !== pageId) return;

      processingRequests.add(request.token);
      let result;
      try {
        await new Promise(resolve => setTimeout(resolve, 900));
        let conversation = null;
        let lastError = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            const candidate = await collectCurrentConversation();
            if (candidate && Array.isArray(candidate.messages) && candidate.messages.length) {
              conversation = candidate;
              break;
            }
          } catch (error) { lastError = error; }
          if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 850));
        }
        result = conversation
          ? { token: request.token, success: true, conversation, sourceUrl: location.href }
          : { token: request.token, success: false, error: lastError && lastError.message || 'No conversation messages were found on the share page.' };
        if (JSON.stringify(result).length > 3000000) {
          result = { token: request.token, success: false,
            error: 'This conversation is too large for the automatic browser handoff. Use the userscript ZIP export and import its JSON file instead.' };
        }
      } catch (error) {
        result = { token: request.token, success: false,
          error: error && error.message || 'Browser extraction failed.' };
      }
      try {
        await Promise.resolve(GM_setValue(RESULT_KEY, result));
        await Promise.resolve(GM_setValue(REQUEST_KEY, null));
        location.replace(returnTarget.href);
      } catch (error) {
        console.error('[ChatVault] Could not complete same-tab return:', error);
      } finally {
        processingRequests.delete(request.token);
      }
    }
    GM_addValueChangeListener(REQUEST_KEY, (_key, _oldValue, request) => {
      if (request) processBrowserRequest(request);
    });
    Promise.resolve(GM_getValue(REQUEST_KEY)).then(request => {
      if (request) processBrowserRequest(request);
    }).catch(error => console.warn('[ChatVault] Could not read extraction request:', error));
  }
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
