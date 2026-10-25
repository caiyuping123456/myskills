// Read only the selected job, never education from unrelated cards or the panel.
(function () {
  'use strict';
  const SELECTORS = {
    jobCard: '.job-card-box', jobDetailLink: 'a.job-name, a[href*="/job_detail/"]',
    detail: '.job-detail-container, .job-detail-box, .job-banner',
    // The editor is a contenteditable div, not a textarea; it only exists once a
    // conversation is selected.
    chatButtonText: ['立即沟通', '继续沟通', '立即网申'],
    chatInput: 'div.chat-input[contenteditable="true"]',
    chatSend: 'button.btn-send',
    conversationRow: 'li[role="listitem"]',
  };
  const text = (el) => (el && (el.innerText || el.textContent) || '').trim();
  function listCards() { return Array.from(document.querySelectorAll(SELECTORS.jobCard)); }
  function readCard(card) {
    const link = card.querySelector(SELECTORS.jobDetailLink);
    const lines = text(card).split(String.fromCharCode(10)).map(s => s.trim()).filter(Boolean);
    return {
      element: card, href: link?.getAttribute('href') || '',
      title: text(card.querySelector('.job-name')) || lines[0] || '',
      salary: text(card.querySelector('.job-salary')) || '',
      company: text(card.querySelector('.boss-name, .company-name')),
    };
  }
  function findButtonByText(labels, root = document) {
    return Array.from(root.querySelectorAll('a,button')).find(el => labels.includes(text(el))) || null;
  }
  function selectedRoot() {
    return Array.from(document.querySelectorAll(SELECTORS.detail)).find(el => !el.closest('.job-card-box') && el.getBoundingClientRect().height > 0) || null;
  }
  function readDetail(root = selectedRoot()) {
    const empty = { title: '', company: '', href: '', education: null, size: null, salary: null, campus: false };
    if (!root) return empty;
    const header = root.querySelector('.job-detail-header, .job-header, .info-primary') || root;
    const metadata = header.querySelector('.tag-list, .job-info, .text-desc');
    // Only explicit header tags; description/resume/panel text must not qualify.
    const candidates = metadata ? [text(metadata), ...Array.from(metadata.querySelectorAll('li,span,p')).map(text)] : [];
    const degrees = [...new Set(candidates.map(window.BossFilters.normalizeEducation).filter(Boolean))];
    const button = findButtonByText(SELECTORS.chatButtonText, root);
    const ka = button?.getAttribute('ka') || '';
    const identity = ka.match(/([a-f0-9]{16}[A-Za-z0-9_~\-]+)$/)?.[1];
    const body = text(root);
    return {
      title: text(header.querySelector('.job-name, .job-title, h1')),
      company: text(root.querySelector('.company-name, .boss-name')),
      href: identity ? '/job_detail/' + identity + '.html' : '',
      education: degrees.length === 1 ? degrees[0] : null,
      size: window.BossFilters.findSize(body),
      salary: text(header.querySelector('.job-salary, .salary')) || window.BossFilters.parseSalary(body)?.raw || null,
      campus: /秋招|校招|应届|在校/.test(text(header)),
    };
  }
  function detailMatches(detail, card) {
    if (!detail || detail.title !== card.title) return false;
    if (detail.href && card.href) return detail.href.split('?')[0] === card.href.split('?')[0];
    return Boolean(detail.company && card.company && detail.company === card.company);
  }
  async function waitForDetail(card, { timeoutMs = 6500, cancelled = () => false } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline && !cancelled()) {
      const detail = readDetail();
      if (detailMatches(detail, card)) return detail;
      await sleep(150);
    }
    throw new Error('当前岗位详情未确认，跳过，防止误用其他岗位学历');
  }
  async function typeAndSend(message) {
    const input = document.querySelector(SELECTORS.chatInput);
    if (!input) return 'no-input';
    // contenteditable div: focus, insert, then dispatch input so Vue sees it.
    input.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, message);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: message, inputType: 'insertText' }));
    await sleep(500);
    const send = document.querySelector(SELECTORS.chatSend);
    if (!send || send.disabled || send.classList.contains('disabled')) return 'no-send-button';
    send.click();
    // A click alone is not proof of delivery. Do not label it sent.
    await sleep(800);
    return 'submitted-unverified';
  }
  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
  window.BossDom = { SELECTORS, listCards, readCard, readDetail, detailMatches, waitForDetail, selectedRoot, findButtonByText, typeAndSend, sleep };
})();
