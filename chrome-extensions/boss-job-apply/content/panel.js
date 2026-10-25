// BOSS投递助手 - in-page floating panel.
// Runs as a content script on zhipin.com job pages. Renders a Shadow-DOM panel,
// filters job cards by company size and salary, then sends the greeting.
(function () {
  'use strict';

  if (window.__bossApplyPanelLoaded) return;
  window.__bossApplyPanelLoaded = true;

  const F = window.BossFilters;
  const D = window.BossDom;

  const DEFAULT_CONFIG = {
    greeting: '您好，我是27届本科，求职Java后端/全栈/Agent开发。有两段后端实习，熟悉Spring Boot、MySQL、Redis。方便发您简历看看吗？',
    titleKeywords: 'java',
    sizeAllow: ['20-99人', '100-499人', '500-999人'],
    educationAllow: ['本科', '学历不限'],
    dailyPayFloor: 200,
    campusMonthlyFloorK: 7,
    salaryMode: 'rangeMax',
    targetCount: 10,
    minDelayMs: 3000,
    maxDelayMs: 8000,
    blockedCompanies: '腾讯,字节,华为,快手,京东,特斯拉,蔚来,大疆,迈瑞,美团,阿里巴巴,网易,百度,小米,拼多多,滴滴,中兴,小红书,顺丰,深信服,亚信,高途,长亮科技',
  };

  const state = { running: false, paused: false, sent: 0, stop: false, config: { ...DEFAULT_CONFIG } };

  // ---------- storage ----------
  function loadConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get('bossApplyConfig', (res) => {
          if (res && res.bossApplyConfig) Object.assign(state.config, res.bossApplyConfig);
          resolve(state.config);
        });
      } catch { resolve(state.config); }
    });
  }
  function saveConfig() {
    try { chrome.storage.local.set({ bossApplyConfig: state.config }); } catch {}
  }

  // ---------- UI ----------
  const host = document.createElement('div');
  host.id = 'boss-apply-panel-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('link');
  style.rel = 'stylesheet';
  style.href = chrome.runtime.getURL('content/panel.css');
  shadow.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'boss-panel';
  panel.innerHTML = `
    <div class="head"><span>BOSS投递助手</span><span class="toggle" title="折叠/展开">—</span></div>
    <div class="body">
      <div class="field"><label>打招呼语</label><textarea id="greeting"></textarea></div>
      <div class="row">
        <div class="field"><label>标题关键词</label><input type="text" id="titleKeywords" placeholder="java"></div>
        <div class="field"><label>目标数量</label><input type="number" id="targetCount" min="1" max="50"></div>
      </div>
      <div class="field"><label>公司规模</label>
        <div class="checks" id="sizeChecks"></div>
      </div>
      <div class="field"><label>岗位学历要求（按要求匹配，非个人最高学历）</label><div class="checks" id="educationChecks"></div><small>学历未知或有歧义时跳过，不推测。</small></div>
      <div class="row">
        <div class="field"><label>日薪下限(元/天)</label><input type="number" id="dailyPayFloor" min="0"></div>
        <div class="field"><label>校招月薪下限(K)</label><input type="number" id="campusMonthlyFloorK" min="0"></div>
      </div>
      <div class="field"><label>排除公司(逗号分隔)</label><textarea id="blockedCompanies"></textarea></div>
      <div class="btns">
        <button id="start">开始</button>
        <button id="pause" disabled>暂停</button>
        <button id="stop" disabled>停止</button>
      </div>
      <div class="status" id="status">空闲</div>
      <div class="log" id="log"></div>
      <div class="hint">只发送打招呼语，不自动发简历。请在职位搜索结果页使用。</div>
    </div>`;

  shadow.appendChild(panel);

  const $ = (id) => panel.querySelector('#' + id);
  const logEl = $('log');

  function log(text, kind) {
    const line = document.createElement('div');
    if (kind) line.className = kind;
    line.textContent = text;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(text) { $('status').textContent = text; }

  // size checkboxes
  const sizeBox = $('sizeChecks');
  F.SIZE_BUCKETS.forEach((b) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = b;
    label.appendChild(cb);
    label.appendChild(document.createTextNode(b));
    sizeBox.appendChild(label);
  });

  const educationBox = $('educationChecks');
  F.EDUCATION_BUCKETS.forEach((value) => {
    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = value;
    label.append(cb, document.createTextNode(value));
    educationBox.appendChild(label);
  });

  function fillForm() {
    const c = state.config;
    if (!Array.isArray(c.educationAllow)) c.educationAllow = ['本科', '学历不限'];
    educationBox.querySelectorAll('input').forEach(cb => { cb.checked = c.educationAllow.includes(cb.value); });
    $('greeting').value = c.greeting;
    $('titleKeywords').value = c.titleKeywords;
    $('targetCount').value = c.targetCount;
    $('dailyPayFloor').value = c.dailyPayFloor;
    $('campusMonthlyFloorK').value = c.campusMonthlyFloorK;
    $('blockedCompanies').value = c.blockedCompanies;
    sizeBox.querySelectorAll('input').forEach((cb) => { cb.checked = c.sizeAllow.includes(cb.value); });
  }

  function readForm() {
    const c = state.config;
    c.greeting = $('greeting').value.trim();
    c.titleKeywords = $('titleKeywords').value.trim();
    c.targetCount = Math.max(1, Math.min(50, parseInt($('targetCount').value, 10) || 10));
    c.dailyPayFloor = parseInt($('dailyPayFloor').value, 10) || 0;
    c.campusMonthlyFloorK = parseInt($('campusMonthlyFloorK').value, 10) || 0;
    c.blockedCompanies = $('blockedCompanies').value.trim();
    c.sizeAllow = Array.from(sizeBox.querySelectorAll('input:checked')).map((cb) => cb.value);
    c.educationAllow = Array.from(educationBox.querySelectorAll('input:checked')).map(cb => cb.value);
    saveConfig();
    return c;
  }

  panel.querySelector('.head .toggle').addEventListener('click', () => panel.classList.toggle('collapsed'));

  // ---------- drag ----------
  (function makeDraggable() {
    const head = panel.querySelector('.head');
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    head.addEventListener('mousedown', (e) => {
      if (e.target.classList.contains('toggle')) return;
      dragging = true;
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = (ox + e.clientX - sx) + 'px';
      panel.style.top = (oy + e.clientY - sy) + 'px';
      panel.style.right = 'auto'; panel.style.bottom = 'auto';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  })();

  // ---------- engine ----------
  function randDelay(c) {
    const min = c.minDelayMs || 3000, max = c.maxDelayMs || 8000;
    return min + Math.random() * Math.max(0, max - min);
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function waitWhilePaused() {
    while (state.paused && !state.stop) await wait(300);
  }

  function blockedList(c) {
    return (c.blockedCompanies || '').split(',').map((s) => s.trim()).filter(Boolean);
  }

  // Click a job card so the detail pane renders, then read size + salary.
  async function openAndRead(card) {
    card.scrollIntoView({ block: 'center' });
    card.click();
    return await D.waitForDetail(D.readCard(card), { cancelled: () => state.stop });
  }

  // Clicking 立即沟通 already sends the account's saved greeting. There is no
  // typing step, and typing here would deliver a second message.
  async function sendGreeting() {
    await waitWhilePaused();
    if (state.stop) return 'stopped';
    const root = D.selectedRoot() || document;
    const external = D.findButtonByText(['立即网申'], root);
    if (external) return 'external-application-only';
    const already = D.findButtonByText(['继续沟通'], root);
    if (already) return 'already-sent';
    const btn = D.findButtonByText(['立即沟通'], root);
    if (!btn) return 'no-chat-button';
    btn.click();
    // A click alone is not proof of delivery; the caller checks the chat list.
    await wait(4500);
    await waitWhilePaused();
    if (state.stop) return 'stopped';
    return 'submitted-unverified';
  }

  async function run() {
    const c = readForm();
    if (!c.educationAllow.length || !c.greeting) { log('请勾选学历并填写招呼语', 'err'); return; }
    state.running = true; state.paused = false; state.stop = false; state.sent = 0;
    $('start').disabled = true; $('pause').disabled = false; $('stop').disabled = false;
    $('pause').textContent = '暂停';
    log('开始运行：目标 ' + c.targetCount + ' 条', 'ok');

    const keywords = c.titleKeywords.split(',').map((s) => s.trim()).filter(Boolean);
    const blocked = blockedList(c);

    // Snapshot once: never loop over the same candidates when nothing is sent.
    const visited = new Set();
    while (!state.stop && state.sent < c.targetCount) {
      await waitWhilePaused();
      if (state.stop) break;

      const cards = D.listCards();
      let progressed = false;

      for (const card of cards) {
        if (state.stop || state.sent >= c.targetCount) break;
        await waitWhilePaused();
        if (state.stop) break;

        const job = D.readCard(card);
        const key = job.href || job.company + job.title;
        if (visited.has(key)) continue;
        visited.add(key);
        if (!job.title || !F.titleMatches(job.title, keywords)) continue;
        if (F.isBlocked(job.company, blocked)) {
          log('跳过(大厂) ' + job.company + ' · ' + job.title, 'skip');
          continue;
        }

        progressed = true;
        setStatus('处理：' + job.title);
        try {
          const detail = await openAndRead(card);
          const decision = F.evaluateJob(
            { size: detail.size, salary: detail.salary, campus: detail.campus, education: detail.education },
            c
          );
          if (!decision.ok) {
            log('跳过(' + decision.why + ') ' + job.company + ' · ' + job.title, 'skip');
            continue;
          }
          await waitWhilePaused();
          if (state.stop) break;
          log('已核验学历：' + detail.education + ' · ' + job.title);
          const result = await sendGreeting();
          if (result === 'sent' || result === 'already-sent') {
            state.sent++;
            log('已发送 ' + job.company + ' · ' + job.title + ' (' + decision.why + ')', 'ok');
          } else {
            log('未确认送达(' + result + ') ' + job.company + ' · ' + job.title, 'err');
            if (result === 'submitted-unverified') { state.stop = true; log('已尝试发送但未确认送达，停止以避免重复发送。', 'err'); }
          }
        } catch (e) {
          log('出错 ' + job.company + ' · ' + job.title + '：' + (e && e.message), 'err');
        }
        setStatus('已发送 ' + state.sent + ' / ' + c.targetCount);
        await wait(randDelay(c));
      }

      if (!progressed) {
        log('当前页没有更多匹配岗位。请翻页后再次点击开始。', 'skip');
        break;
      }
    }

    setStatus(state.stop ? '已停止' : '完成，共发送 ' + state.sent + ' 条');
    log(state.stop ? '已手动停止' : '任务完成', 'ok');
    state.running = false;
    $('start').disabled = false; $('pause').disabled = true; $('stop').disabled = true;
  }

  $('start').addEventListener('click', () => { if (!state.running) run(); });
  $('pause').addEventListener('click', () => {
    state.paused = !state.paused;
    $('pause').textContent = state.paused ? '继续' : '暂停';
    setStatus(state.paused ? '已暂停' : '运行中');
  });
  $('stop').addEventListener('click', () => { state.stop = true; state.paused = false; });

  loadConfig().then(fillForm);
})();
