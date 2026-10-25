#!/usr/bin/env node
// Filter collected jobs by company size, salary and education, then send the
// greeting through the job-detail page.
//
// Sending model: clicking 立即沟通 sends the account's saved default greeting
// immediately. There is no text box to fill in. Because of that this script
// cannot change the wording — it only decides who to contact. Check that the
// saved greeting in the BOSS app matches `greeting` in config.json before a run.
//
// Delivery is verified against the conversation list rather than assumed from
// a successful click. Resumable: progress in <outputDir>/apply-progress.json.
//
// Usage:
//   node scripts/apply-jobs.mjs [config.json] [--dry-run]
//
// --dry-run evaluates every filter and prints the would-send list without
// clicking anything. Run it first.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  newTab, closeTab, evalIn, sleep, listTabs,
  readJobDetail, startChat, verifyGreeting, CHAT_BUTTONS,
} from './cdp.mjs';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const configPath = argv.find((a) => !a.startsWith('--')) || fileURLToPath(new URL('./config.json', import.meta.url));
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const outDir = path.resolve(path.dirname(configPath), config.outputDir || './out');
fs.mkdirSync(outDir, { recursive: true });
const candidates = JSON.parse(fs.readFileSync(path.join(outDir, 'candidates.json'), 'utf8'));
const progressFile = path.join(outDir, dryRun ? 'dry-run-progress.json' : 'apply-progress.json');

let state = { applied: 0, checked: [], results: [] };
if (fs.existsSync(progressFile)) {
  try { state = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch {}
}
const checked = new Set(state.checked);
const sizeAllow = new Set(config.companySizeAllow || []);
const educationAllow = new Set(config.educationAllow || []);
const blocked = (config.blockedCompanies || []).map((s) => s.toLowerCase());
const blockedPatterns = (config.blockedCompanyPatterns || []).map((s) => new RegExp(s, 'i'));
const limit = config.targetCount || 50;
const campusMonthlyFloor = config.campusMonthlyFloorK ?? 7;
const dailyPayFloor = config.dailyPayFloor ?? 200;

function parseSalary(text) {
  const range = String(text || '').match(/(\d{2,4})-(\d{2,4})元\/天/);
  if (range) return { kind: 'daily', low: +range[1], high: +range[2] };
  const single = String(text || '').match(/(\d{2,4})元\/天/);
  if (single) return { kind: 'daily', low: +single[1], high: +single[1] };
  const monthly = String(text || '').match(/(\d{1,3})-(\d{1,3})K/);
  if (monthly) return { kind: 'monthly', low: +monthly[1], high: +monthly[2] };
  return null;
}

function isBlocked(job) {
  const company = (job.company || '').toLowerCase();
  const haystack = (job.company || '') + ' ' + (job.title || '');
  if (blocked.some((b) => company.includes(b))) return true;
  return blockedPatterns.some((re) => re.test(haystack));
}

// Unknown data fails closed: a job with an unreadable size, salary or
// education is skipped rather than guessed.
function qualifies(info) {
  if (!info.size) return { ok: false, why: 'company-size-unknown' };
  if (!sizeAllow.has(info.size)) return { ok: false, why: 'company-size:' + info.size };
  if (educationAllow.size && !educationAllow.has(info.education || '(未知)')) {
    return { ok: false, why: 'education:' + (info.education || 'unknown') };
  }
  const s = parseSalary(info.salary);
  if (!s) return { ok: false, why: 'salary-unparsed' };
  // rangeMin is the only mode that honours a stated floor; rangeMax lets a
  // "150-200元/天" posting pass a 200 floor.
  const value = config.salaryMode === 'rangeMax' ? s.high : s.low;
  if (s.kind === 'daily') {
    if (value >= dailyPayFloor) return { ok: true, why: 'daily>=' + dailyPayFloor };
    return { ok: false, why: 'daily<' + dailyPayFloor };
  }
  if (campusMonthlyFloor && info.campus && value >= campusMonthlyFloor) {
    return { ok: true, why: 'campus-monthly>=' + campusMonthlyFloor + 'K' };
  }
  return { ok: false, why: 'salary' };
}

// The chat tab is long-lived and is the only place delivery can be confirmed.
const tabs0 = await listTabs();
const chatTab = tabs0.find((t) => t.type === 'page' && t.url.includes('/web/geek/chat'));
if (!chatTab && !dryRun) {
  console.error('No /web/geek/chat tab is open. Log in and open the chat page first.');
  process.exit(1);
}

for (const job of candidates) {
  if (state.applied >= limit) break;
  if (checked.has(job.href)) continue;
  if (isBlocked(job)) { checked.add(job.href); continue; }

  const { tabId, info } = await readJobDetail(job.href).catch(() => ({ tabId: null, info: null }));
  if (!info) {
    checked.add(job.href);
    if (tabId) await closeTab(tabId);
    continue;
  }

  const decision = qualifies(info);
  const record = {
    ...job,
    size: info.size,
    salary: info.salary,
    education: info.education || '',
    button: info.button,
    attemptedAt: new Date().toISOString(),
  };

  if (!decision.ok) {
    state.results.push({ ...record, skipped: decision.why });
    checked.add(job.href);
    state.checked = [...checked];
    fs.writeFileSync(progressFile, JSON.stringify(state, null, 2), 'utf8');
    if (tabId) await closeTab(tabId);
    await sleep(300);
    continue;
  }

  // 立即网申 hands off to the employer's own form: no greeting can be sent.
  if (info.button === CHAT_BUTTONS.EXTERNAL) {
    state.results.push({ ...record, skipped: 'external-application-only' });
    checked.add(job.href);
    state.checked = [...checked];
    fs.writeFileSync(progressFile, JSON.stringify(state, null, 2), 'utf8');
    if (tabId) await closeTab(tabId);
    await sleep(300);
    continue;
  }
  if (info.button === CHAT_BUTTONS.ALREADY) {
    state.results.push({ ...record, skipped: 'already-contacted' });
    checked.add(job.href);
    state.checked = [...checked];
    fs.writeFileSync(progressFile, JSON.stringify(state, null, 2), 'utf8');
    if (tabId) await closeTab(tabId);
    await sleep(300);
    continue;
  }

  if (dryRun) {
    state.results.push({ ...record, wouldSend: decision.why });
    checked.add(job.href);
    state.checked = [...checked];
    fs.writeFileSync(progressFile, JSON.stringify(state, null, 2), 'utf8');
    if (tabId) await closeTab(tabId);
    await sleep(300);
    continue;
  }

  try {
    const tabs = await listTabs();
    const ws = tabs.find((t) => t.id === tabId)?.webSocketDebuggerUrl;
    if (!ws) throw new Error('tab-gone');

    const clicked = await startChat(ws);
    if (clicked !== CHAT_BUTTONS.SEND) throw new Error('unexpected-button:' + clicked);

    await sleep(4000);

    // The click leaves a duplicate chat tab behind; keep the original one and
    // close the extra so the tab count does not grow without bound.
    const after = await listTabs();
    const extras = after.filter((t) => t.type === 'page' && t.url.includes('/web/geek/chat') && t.id !== chatTab.id);
    for (const t of extras) await closeTab(t.id);
    await closeTab(tabId).catch(() => {});

    const verdict = await verifyGreeting(chatTab.id, job.company, config.greeting);
    const outcome = verdict.ok
      ? (verdict.delivered ? 'sent-verified' : 'sent-unconfirmed')
      : 'UNVERIFIED-not-in-list';
    if (outcome === 'sent-verified') state.applied++;
    state.results.push({ ...record, outcome, row: verdict.row, why: verdict.why });
  } catch (e) {
    state.results.push({ ...record, outcome: 'ERROR', error: String(e.message || e) });
    if (tabId) await closeTab(tabId).catch(() => {});
  }

  checked.add(job.href);
  state.checked = [...checked];
  fs.writeFileSync(progressFile, JSON.stringify(state, null, 2), 'utf8');
  await sleep(800);
}

const tally = {};
for (const r of state.results) {
  const key = r.outcome || r.skipped || (r.wouldSend ? 'would-send' : 'unknown');
  tally[key] = (tally[key] || 0) + 1;
}
console.log(JSON.stringify({ applied: state.applied, checked: state.checked.length, tally }, null, 2));

// Excel summary: always ask for a destination before writing. Non-interactive
// runs must pass --excel <path>; nothing is written silently.
if (!opts.noExcel) {
  let target = opts.excel;
  if (!target) {
    target = await promptForOutputPath(nextDefaultPath(progressFile));
    if (!target) {
      console.error('未保存 Excel：当前不是交互式终端。请先询问用户保存位置，再运行：');
      console.error('  node scripts/export-excel.mjs ' + progressFile + ' --output <路径> --no-prompt');
    }
  }
  if (target && target !== 'skip') {
    try {
      const result = await exportProgress(progressFile, target);
      console.log('Excel 已保存：' + result.file + '（' + result.rows + ' 行）');
    } catch (e) {
      console.error('Excel 导出失败：' + (e.message || e));
    }
  } else if (target === 'skip') {
    console.log('已跳过 Excel 导出。');
  }
}
