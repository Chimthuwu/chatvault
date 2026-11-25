// ChatVault userscript UI. Inlined by scripts/build-userscript.mjs after the shared modules.
(() => {
  'use strict';
  if (window.__chatVaultV3Loaded) return;

  window.__chatVaultV3Loaded = true;
  const host = location.hostname.toLowerCase();
  const isChatVaultOrigin = location.hostname === 'chat-vault.pages.dev' ||
    location.hostname.endsWith('.chat-vault.pages.dev');
  const REQUEST_KEY = 'chatvault:browser-extract-request';
  const isExtractionTarget = (target, platform) =>
    platform.share.test(target.pathname) ||
    (platform.id === 'chatgpt' && /^\/c\/[A-Za-z0-9_-]+\/?$/.test(target.pathname));
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
        returnTarget.hostname.endsWith('.chat-vault.pages.dev');
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
      position: fixed; top: 50%; right: 8px; transform: translateY(-50%);
      z-index: 2147483000; display: flex; flex-direction: column; align-items: stretch;
      gap: 7px; width: 176px; max-height: min(82vh, 680px); overflow: hidden;
      padding: 7px; border-radius: 15px;
      background: linear-gradient(145deg, rgba(19,48,43,.98), rgba(11,24,29,.97) 58%, rgba(30,25,49,.96));
      border: 1px solid rgba(73,220,181,.48);
      box-shadow: 0 12px 38px #000a, 0 0 22px rgba(0,220,165,.10), inset 0 1px rgba(255,255,255,.08);
      font-family: system-ui, sans-serif; backdrop-filter: blur(16px);
      transition: width .24s ease, padding .24s ease, border-radius .24s ease, box-shadow .24s ease;
    }
    #cv3-toolbar:hover { box-shadow: 0 14px 42px #000b, 0 0 28px rgba(0,220,165,.18), inset 0 1px rgba(255,255,255,.1); }
    #cv3-toggle {
      width: 100%; min-height: 38px; padding: 8px 9px; border-radius: 10px;
      border: 1px solid rgba(91,255,208,.72); background: linear-gradient(115deg, #12624f, #16866d 55%, #155d70);
      color: #d4fff2; font: 850 12px system-ui, sans-serif; cursor: pointer; white-space: nowrap;
      box-shadow: inset 0 1px rgba(255,255,255,.18), 0 3px 12px rgba(0,220,165,.16);
      transition: transform .18s ease, filter .18s ease, box-shadow .18s ease, border-color .18s ease;
    }
    #cv3-toggle:hover { transform: translateY(-2px); filter: brightness(1.18) saturate(1.12); border-color: #b4ffe9; box-shadow: 0 6px 18px rgba(0,220,165,.25), inset 0 1px rgba(255,255,255,.24); }
    #cv3-toggle:active { transform: translateY(0) scale(.98); }
    #cv3-actions { display:flex; flex-direction:column; flex-wrap:nowrap; gap:6px; width:100%; min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#4a9b83 transparent; }
    #cv3-toolbar.cv3-collapsed #cv3-actions { display:none; }
    #cv3-toolbar.cv3-collapsed { width:58px; padding:5px; border-radius:14px; background:linear-gradient(145deg,rgba(19,48,43,.98),rgba(22,35,47,.97)); }
    #cv3-toolbar.cv3-collapsed #cv3-toggle { min-height:42px; padding:7px 3px; font-size:13px; }
    #cv3-toolbar button {
      position:relative; isolation:isolate; flex:0 0 auto; width:100%; min-height:36px; padding:8px 9px;
      border-radius:9px; border:1px solid rgba(87,173,148,.45); background:linear-gradient(115deg,rgba(25,74,62,.98),rgba(21,58,61,.98));
      color:#a7ffe0; font:750 11px/1.4 system-ui,sans-serif; cursor:pointer; text-align:left; white-space:normal; overflow-wrap:anywhere;
      box-shadow:inset 0 1px rgba(255,255,255,.07),0 2px 7px rgba(0,0,0,.16);
      transition:transform .17s ease,background .2s ease,border-color .2s ease,color .2s ease,box-shadow .2s ease,filter .2s ease;
    }
    #cv3-toolbar button:hover:not(:disabled) { transform:translateX(-3px); filter:brightness(1.15) saturate(1.12); border-color:rgba(148,255,219,.9); color:#effff9; box-shadow:0 5px 16px rgba(0,0,0,.24),0 0 13px rgba(0,220,165,.14),inset 0 1px rgba(255,255,255,.14); }
    #cv3-toolbar button:active:not(:disabled) { transform:translateX(-1px) scale(.99); }
    #cv3-toolbar button:focus-visible { outline:2px solid #b8ffe9; outline-offset:2px; }
    #cv3-toolbar button:disabled { opacity:.58; cursor:wait; }
    #cv3-toolbar #cv3-zip { background:linear-gradient(110deg,#116b57,#087e75); border-color:#42e6b7; color:#d5fff1; }
    #cv3-toolbar #cv3-beautify { background:linear-gradient(110deg,#493276,#34275f 60%,#243f69); border-color:#b39cff; color:#eee5ff; }
    #cv3-toolbar #cv3-archive { background:linear-gradient(110deg,#17634d,#1a795e 55%,#176b73); border-color:#8bf0bd; color:#e2fff0; }
    #cv3-toolbar #cv3-handoff { background:linear-gradient(110deg,#49316f,#563b83 55%,#304f79); border-color:#c0a5ff; color:#f0e7ff; }
    #cv3-toolbar #cv3-handoff:hover:not(:disabled) { box-shadow:0 5px 18px rgba(137,100,255,.28),0 0 16px rgba(173,139,255,.2); border-color:#e2d3ff; }
    #cv3-status { position:relative; right:auto; top:auto; bottom:auto; transform:none; z-index:auto; width:100%; max-width:none; margin-top:2px; padding:9px 11px; border-radius:9px; background:linear-gradient(135deg,rgba(17,31,31,.98),rgba(17,24,39,.98)); border:1px solid rgba(76,200,163,.52); color:#b4ffe4; font:13px/1.5 system-ui,sans-serif; box-shadow:0 6px 18px #0007,0 0 12px rgba(0,220,165,.08); display:none; overflow-wrap:anywhere; }
    #cv3-toolbar.cv3-collapsed #cv3-status { display:none!important; }
    @media (prefers-reduced-motion:no-preference) {
      #cv3-toolbar:not(.cv3-collapsed) #cv3-handoff { animation:cv3-soft-pulse 4.5s ease-in-out infinite; }
      @keyframes cv3-soft-pulse { 0%,100% { box-shadow:inset 0 1px rgba(255,255,255,.07),0 2px 7px rgba(0,0,0,.16); } 50% { box-shadow:inset 0 1px rgba(255,255,255,.12),0 3px 13px rgba(137,100,255,.13); } }
    }
    @media (prefers-reduced-motion:reduce) { #cv3-toolbar,#cv3-toolbar button,#cv3-toggle { transition:none!important; animation:none!important; } }
    @media (max-width:700px) { #cv3-toolbar { right:5px; width:158px; } #cv3-status { right:172px; width:min(260px,calc(100vw - 190px)); } }
  `;
  document.head.appendChild(style);

  const toolbar = document.createElement('div');
  toolbar.id = 'cv3-toolbar';
  const toggleButton = document.createElement('button');
  toggleButton.id = 'cv3-toggle';
  toggleButton.type = 'button';
  toggleButton.setAttribute('aria-controls', 'cv3-actions');
  const actions = document.createElement('div');
  actions.id = 'cv3-actions';
  const statusBox = document.createElement('div');
  statusBox.id = 'cv3-status';
  document.body.append(toolbar);

  let statusTimer = null;
  function dismissStatus() {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    statusBox.style.display = 'none';
  }
  function status(message, error = false) {
    if (statusTimer !== null) clearTimeout(statusTimer);
    statusTimer = null;
    statusBox.textContent = message;
    statusBox.style.color = error ? '#ffaaaa' : '#9fffd9';
    // The notification belongs to the expanded toolbar. Never leave it floating
    // beside the page after the user collapses the ChatVault control.
    statusBox.style.display = collapsed ? 'none' : 'block';
    if (!collapsed) {
      statusTimer = setTimeout(() => {
        statusBox.style.display = 'none';
        statusTimer = null;
      }, 6500);
    }
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
    actions.appendChild(button);
  }

  const archiveButton = document.createElement('button');
  archiveButton.id = 'cv3-archive';
  archiveButton.type = 'button';
  archiveButton.textContent = '↗ ARCHIVE + BEAUTIFY';
  archiveButton.title = 'Create or reuse a ChatGPT share link, then import and beautify it in ChatVault';
  actions.insertBefore(archiveButton, actions.firstChild);
  if (detectPagePlatform().id !== 'chatgpt') archiveButton.hidden = true;

  const handoffButton = document.createElement('button');
  handoffButton.id = 'cv3-handoff';
  handoffButton.type = 'button';
  handoffButton.textContent = '⧉ COPY AGENT HANDOFF';
  handoffButton.title = 'Generate the structured agent handoff and copy it to your clipboard';
  actions.insertBefore(handoffButton, archiveButton);

  const COLLAPSE_KEY = 'chatvault:toolbar-collapsed';
  let collapsed = true;
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    if (saved === '0') collapsed = false;
  } catch {}
  function setCollapsed(next) {
    collapsed = Boolean(next);
    if (collapsed) dismissStatus();
    toolbar.classList.toggle('cv3-collapsed', collapsed);
    toggleButton.textContent = collapsed ? '🔓📜 CV +' : '🔓📜 CV −';
    toggleButton.title = collapsed ? 'Expand ChatVault tools' : 'Collapse ChatVault tools';
    toggleButton.setAttribute('aria-expanded', String(!collapsed));
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch {}
  }
  toggleButton.addEventListener('click', () => setCollapsed(!collapsed));
  toolbar.append(toggleButton, actions, statusBox);
  setCollapsed(collapsed);

  const CHATVAULT_HOME = 'https://chat-vault.pages.dev/';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  function visibleElement(element) {
    return !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length));
  }
  function readShareUrl() {
    const candidates = [...document.querySelectorAll('[role="dialog"] a[href], [role="dialog"] input, [role="dialog"] textarea')];
    for (const element of candidates) {
      const value = element.href || element.value || element.getAttribute('value') || '';
      try {
        const url = new URL(value, location.href);
        if (url.protocol === 'https:' && /(^|\.)chatgpt\.com$/.test(url.hostname) &&
            /^\/share\/[A-Za-z0-9_-]+/.test(url.pathname)) return url.href;
      } catch {}
    }
    return '';
  }
  async function waitForShareUrl(timeout = 18000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      const link = readShareUrl();
      if (link) return link;
      await sleep(250);
    }
    return '';
  }
  function findShareAction(labels) {
    const buttons = [...document.querySelectorAll('[role="dialog"] button, [role="dialog"] [role="button"], button')].filter(visibleElement);
    return buttons.find(button => {
      const label = [button.innerText, button.textContent, button.getAttribute('aria-label'),
        button.getAttribute('data-testid'), button.title].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      return labels.some(pattern => pattern.test(label));
    });
  }
  async function createOrGetChatGPTShareUrl() {
    if (detectPagePlatform().id !== 'chatgpt' || !getChatRoute()) {
      throw new Error('Open a ChatGPT conversation first. This action currently creates share links for ChatGPT chats.');
    }
    const existing = readShareUrl();
    if (existing) return existing;
    const shareButton = [...document.querySelectorAll('button, [role="button"]')].find(button => {
      if (!visibleElement(button)) return false;
      const label = [button.innerText, button.getAttribute('aria-label'), button.title, button.dataset.testid]
        .filter(Boolean).join(' ').trim();
      return /(^|\b)share(\b|$)/i.test(label) && !/shared link/i.test(label);
    });
    if (!shareButton) throw new Error('Could not find ChatGPT’s Share button. Open the conversation fully and try again.');
    shareButton.click();
    await sleep(350);
    let link = await waitForShareUrl(900);
    if (link) return link;
    const createButton = findShareAction([/create\s+(a\s+)?link/i, /create\s+shared\s+link/i, /share\s+link/i]);
    if (createButton) {
      createButton.click();
      link = await waitForShareUrl(12000);
      if (link) return link;
    }
    const copyButton = findShareAction([/copy\s+link/i, /copy\s+shared\s+link/i]);
    if (copyButton) {
      copyButton.click();
      await sleep(350);
      link = readShareUrl();
      if (link) return link;
      try {
        const clipboard = await navigator.clipboard.readText();
        const url = new URL(clipboard.trim());
        if (url.protocol === 'https:' && /(^|\.)chatgpt\.com$/.test(url.hostname) &&
            /^\/share\/[A-Za-z0-9_-]+/.test(url.pathname)) return url.href;
      } catch {}
    }
    throw new Error('ChatGPT did not expose a share URL. Check the Share dialog and try again.');
  }

  async function archiveAndBeautify() {
    if (archiveButton.disabled) return;
    archiveButton.disabled = true;
    let destination = null;
    try {
      destination = window.open('about:blank', '_blank');
      if (!destination) throw new Error('The browser blocked the ChatVault tab. Allow popups for ChatGPT and try again.');
      status('Creating or retrieving the ChatGPT share link…');
      const shareUrl = await createOrGetChatGPTShareUrl();
      const target = new URL(shareUrl);
      if (target.origin !== 'https://chatgpt.com' && target.origin !== 'https://chat.openai.com') {
        throw new Error('ChatGPT returned an unexpected share-link host.');
      }
      const handoff = new URL(CHATVAULT_HOME);
      handoff.searchParams.set('cv-share', target.href);
      handoff.searchParams.set('cv-auto', '1');
      destination.location.replace(handoff.href);
      status('✓ Share link captured. ChatVault is importing, archiving and beautifying this conversation in the new tab.');
    } catch (error) {
      if (destination && !destination.closed) destination.close();
      status(error.message || 'Could not archive this conversation.', true);
    } finally {
      archiveButton.disabled = false;
    }
  }
  archiveButton.addEventListener('click', archiveAndBeautify);

  async function copyAgentHandoff() {
    if (handoffButton.disabled) return;
    handoffButton.disabled = true;
    try {
      status('Reading the conversation and preparing agent handoff…');
      const conv = await collectCurrentConversation();
      if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
        throw new Error('No conversation messages were found on this page.');
      }
      const transcript = renderMarkdown(conv);
      const structuredBrief = buildAgentHandoff(conv);
      const handoff = [
        structuredBrief,
        '## Full conversation transcript',
        '',
        transcript.trim(),
        ''
      ].join('\n');
      try {
        await navigator.clipboard.writeText(handoff);
      } catch (clipboardError) {
        const textarea = document.createElement('textarea');
        textarea.value = handoff;
        textarea.setAttribute('readonly', '');
        textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
        document.body.appendChild(textarea);
        textarea.select();
        const copied = document.execCommand('copy');
        textarea.remove();
        if (!copied) throw clipboardError;
      }
      status(`✓ Agent handoff copied to clipboard (${conv.messages.length} messages). Paste it straight into your coding agent.`);
    } catch (error) {
      console.error(PREFIX, error);
      status(error.message || 'Could not generate the agent handoff.', true);
    } finally {
      handoffButton.disabled = false;
    }
  }
  handoffButton.addEventListener('click', copyAgentHandoff);

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
