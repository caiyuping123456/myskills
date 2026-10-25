// Shared Chrome DevTools Protocol helpers for the BOSS直聘 automation scripts.
// Uses raw CDP over WebSocket so we never attach/detach a browser driver that
// would close the user's pages.
export const CDP_HTTP = process.env.BOSS_CDP_HTTP || 'http://127.0.0.1:9222';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function listTabs() {
  const res = await fetch(CDP_HTTP + '/json/list');
  return await res.json();
}

export async function newTab(url) {
  const res = await fetch(CDP_HTTP + '/json/new?' + encodeURIComponent(url), { method: 'PUT' });
  return await res.json();
}

export async function closeTab(id) {
  try { await fetch(CDP_HTTP + '/json/close/' + id); } catch { /* tab already gone */ }
}

export async function evalIn(wsUrl, expression, timeoutMs = 30000) {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      const id = Math.floor(Math.random() * 1e9);
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id === id) {
          try { ws.close(); } catch {}
          resolve(msg.result?.result?.value ?? msg);
        }
      };
      ws.onerror = () => reject(new Error('cdp socket error'));
      ws.send(JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
      setTimeout(() => {
        try { ws.close(); } catch {}
        reject(new Error('cdp timeout'));
      }, timeoutMs);
    };
    ws.onerror = () => reject(new Error('cdp connect error'));
  });
}

export async function evalInTab(id, expression, timeoutMs) {
  const tabs = await listTabs();
  const tab = tabs.find((t) => t.id === id);
  if (!tab) throw new Error('tab-gone');
  return await evalIn(tab.webSocketDebuggerUrl, expression, timeoutMs);
}

export async function urlOfTab(id) {
  const tabs = await listTabs();
  return tabs.find((t) => t.id === id)?.url || '';
}

// Chat-button labels that appear on a job-detail page. 立即沟通 sends the
// greeting; 继续沟通 means this recruiter was contacted before; 立即网申 hands
// off to the employer's own application form and cannot be messaged at all.
export const CHAT_BUTTONS = {
  SEND: '立即沟通',
  ALREADY: '继续沟通',
  EXTERNAL: '立即网申',
};

// Education labels as BOSS prints them in the job header. Anything else is
// treated as unknown so callers can fail closed.
const EDUCATION_LABELS = ['学历不限', '初中及以下', '中专/中技', '高中', '大专', '本科', '硕士', '博士'];

// Open a job-detail page and read company size, salary, education, campus flag
// and the chat button label. The button label decides whether outreach is
// possible, so it is read from the button itself rather than guessed.
export async function readJobDetail(href, { settleMs = 5200 } = {}) {
  const url = href.startsWith('http') ? href : 'https://www.zhipin.com' + href;
  const tab = await newTab(url);
  await sleep(settleMs);
  const info = await evalIn(tab.webSocketDebuggerUrl, `(function(){
    var body = document.body.innerText;
    var size = body.match(/(0-20人|20-99人|100-499人|500-999人|1000-9999人|10000人以上)/);
    var salary = body.match(/[0-9]{2,4}-[0-9]{2,4}元\\/天|[0-9]{2,4}元\\/天|[0-9]{1,3}-[0-9]{1,3}K/);
    var button = null;
    var els = document.querySelectorAll('a.btn-startchat, a.btn, button');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || '').trim();
      if (t === '立即沟通' || t === '继续沟通' || t === '立即网申') { button = t; break; }
    }

    // Education lives in the header tag list, not in the description body, so
    // read only the header block and require an exact label match.
    var labels = ${JSON.stringify(EDUCATION_LABELS)};
    var education = null;
    var header = document.querySelector('.job-banner, .job-detail-header, .info-primary, .job-header');
    if (header) {
      var tags = header.querySelectorAll('span, li, em');
      var found = [];
      for (var j = 0; j < tags.length; j++) {
        var txt = (tags[j].innerText || '').trim();
        if (labels.indexOf(txt) >= 0) found.push(txt);
      }
      if (found.length === 1) education = found[0];
    }

    return {
      size: size ? size[1] : null,
      salary: salary ? salary[0] : null,
      education: education,
      campus: /秋招|校招|应届|在校/.test(body),
      button: button,
      url: location.href,
    };
  })()`).catch(() => null);
  return { tabId: tab.id, info };
}

// Click 立即沟通 on a job-detail page. The click navigates the same tab to the
// chat page and sends the account's saved default greeting — there is no
// second confirmation step and no typing involved.
//
// Returns the label that was clicked, or null if no chat button exists.
export async function startChat(wsUrl) {
  const label = await evalIn(wsUrl, `(function(){
    var els = document.querySelectorAll('a.btn-startchat, a.btn, button');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || '').trim();
      if (t === '立即沟通' || t === '继续沟通') { els[i].click(); return t; }
    }
    return null;
  })()`, 15000);
  return label;
}

// Read the conversation list. Rows are li[role="listitem"]; each row's text
// holds "HH:MM <name><company><role> [送达|已读|未读] <preview>".
export async function listConversations(chatTabId) {
  const rows = await evalInTab(chatTabId, `(function(){
    var out = [];
    var rows = document.querySelectorAll('li[role="listitem"]');
    for (var i = 0; i < rows.length; i++) {
      var t = (rows[i].innerText || '').replace(/\\n+/g, '|').trim();
      if (t) out.push(t);
    }
    return out;
  })()`, 20000);
  return Array.isArray(rows) ? rows : [];
}

// Pick the best row for a company. Rows are newest-first, so an optional
// expected marker helps avoid matching a months-old conversation.
export function matchConversation(rows, company, { deliveredOnly = true } = {}) {
  const name = String(company || '').trim();
  if (!name) return null;
  // Longest distinctive fragment: company names on BOSS often drop 有限公司/科技.
  const short = name.replace(/(有限公司|股份有限公司|科技|信息技术|网络科技|软件)/g, '').slice(0, 4);
  const hits = rows.filter((r) => r.includes(name) || (short.length >= 2 && r.includes(short)));
  if (!hits.length) return null;
  const delivered = hits.filter((r) => /\[送达\]|\[已读\]/.test(r));
  if (deliveredOnly && delivered.length) return delivered[0];
  return (deliveredOnly ? null : hits[0]);
}

// After startChat, verify the greeting actually landed: open the chat tab,
// reload so the list is fresh, and look for a row for this company that shows
// a delivery marker.
export async function verifyGreeting(chatTabId, company, message, { settleMs = 6000 } = {}) {
  await evalInTab(chatTabId, 'location.reload()', 15000).catch(() => {});
  await sleep(settleMs);
  const rows = await listConversations(chatTabId);
  const row = matchConversation(rows, company);
  if (!row) return { ok: false, why: 'not-in-list', rows: rows.length };
  const needle = String(message || '').replace(/\s+/g, '').slice(0, 12);
  const showsGreeting = needle.length > 0 && row.replace(/\s+/g, '').includes(needle);
  return { ok: true, delivered: /\[送达\]|\[已读\]/.test(row), showsGreeting, row };
}

// Type into the chat editor and click send.
//
// The editor is div.chat-input[contenteditable=true]; there is no textarea.
// It only exists once a conversation is selected. NOTE: this path is a fallback
// and has not been exercised end-to-end — startChat normally already sends the
// greeting, so typing here would deliver a SECOND message. Only call it after
// verifying the greeting did not arrive.
export async function typeAndSend(wsUrl, message) {
  return await evalIn(wsUrl, `(async function(){
    var el = document.querySelector('div.chat-input[contenteditable="true"]');
    if (!el) return { ok: false, why: 'no-editor' };
    el.focus();
    var sel = window.getSelection();
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, ${JSON.stringify(message)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(message)}, inputType: 'insertText' }));
    await new Promise(function(r){ setTimeout(r, 600); });
    var btn = document.querySelector('button.btn-send');
    if (!btn) return { ok: false, why: 'no-send-button' };
    if (btn.disabled || /\\bdisabled\\b/.test(btn.className)) return { ok: false, why: 'send-disabled' };
    btn.click();
    await new Promise(function(r){ setTimeout(r, 1200); });
    return { ok: true, submitted: true };
  })()`, 25000);
}
