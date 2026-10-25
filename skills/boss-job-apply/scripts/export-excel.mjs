#!/usr/bin/env node
// Export BOSS application progress to an Excel (.xlsx) summary.
// Never writes until a destination path is provided: interactive runs are
// prompted first, non-interactive runs must pass --output.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeWorkbook } from './xlsx.mjs';

export const HEADERS = [
  '序号', '公司名称', '岗位名称', '薪资', '城市', '公司规模',
  '学历要求', '投递日期', '投递状态', '结果说明', '岗位链接',
];
export const WIDTHS = [6, 26, 32, 16, 10, 12, 14, 18, 18, 42, 52];

const STATUS = {
  'sent-verified': '已投递（已确认）',
  'sent-unconfirmed': '已投递（未确认）',
  'UNVERIFIED-not-in-list': '未确认（聊天列表未找到）',
  ERROR: '失败',
  'already-contacted': '已沟通过',
  'external-application-only': '仅支持官网投递',
  'would-send': '试运行（未发送）',
};

function statusOf(record) {
  if (record.outcome && STATUS[record.outcome]) return STATUS[record.outcome];
  if (record.outcome) return record.outcome;
  if (record.skipped) {
    if (record.skipped === 'already-contacted') return STATUS['already-contacted'];
    if (record.skipped === 'external-application-only') return STATUS['external-application-only'];
    if (record.skipped.startsWith('company-size')) return '跳过（公司规模）';
    if (record.skipped.startsWith('education')) return '跳过（学历）';
    if (record.skipped.startsWith('salary') || record.skipped.startsWith('daily')) return '跳过（薪资）';
    return '跳过';
  }
  if (record.wouldSend) return STATUS['would-send'];
  return '未知';
}

function reasonText(reason) {
  if (!reason) return '';
  if (reason === 'company-size-unknown') return '公司规模未识别';
  if (reason.startsWith('company-size:')) return '公司规模不符：' + reason.slice(13);
  if (reason.startsWith('education:')) return '学历不符：' + reason.slice(10);
  if (reason === 'salary-unparsed') return '薪资无法识别';
  if (reason.startsWith('daily<')) return '日薪低于' + reason.slice(6);
  if (reason.startsWith('daily>=')) return '日薪符合' + reason.slice(6);
  if (reason.startsWith('campus-monthly>=')) return '校招月薪符合' + reason.slice(16);
  if (reason === 'salary') return '薪资不符';
  if (reason === 'external-application-only') return '仅支持官网投递';
  if (reason === 'already-contacted') return '此前已沟通';
  return reason;
}

function noteOf(record) {
  const parts = [];
  if (record.why) parts.push(reasonText(record.why));
  if (record.skipped) parts.push(reasonText(record.skipped));
  if (record.wouldSend) parts.push('试运行：' + reasonText(record.wouldSend));
  if (record.error) parts.push(record.error);
  if (record.row) parts.push(String(record.row));
  return parts.filter(Boolean).join('；');
}

function formatDate(value, fallback) {
  const d = value ? new Date(value) : fallback;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function buildRows(progress, fileMtime = new Date()) {
  const results = Array.isArray(progress?.results) ? progress.results : [];
  return results.map((record, i) => {
    const href = record.href || '';
    const link = href ? (href.startsWith('http') ? href : 'https://www.zhipin.com' + href) : '';
    return [
      i + 1,
      record.company || '',
      record.title || '',
      record.salary || '',
      record.city || '',
      record.size || '',
      record.education || '',
      formatDate(record.attemptedAt, fileMtime),
      statusOf(record),
      noteOf(record),
      link,
    ];
  });
}

export function nextDefaultPath(progressFile) {
  const dir = path.dirname(progressFile);
  const stamp = new Date().toISOString().slice(0, 10);
  return path.join(dir, '投递记录-' + stamp + '.xlsx');
}

export async function exportProgress(progressFile, targetPath) {
  const raw = fs.readFileSync(progressFile, 'utf8');
  const progress = JSON.parse(raw);
  const stat = fs.statSync(progressFile);
  const rows = buildRows(progress, stat.mtime);
  await fs.promises.mkdir(path.dirname(path.resolve(targetPath)), { recursive: true });
  await writeWorkbook(targetPath, {
    headers: HEADERS,
    rows,
    widths: WIDTHS,
    sheetName: '投递记录',
  });
  return { file: path.resolve(targetPath), rows: rows.length };
}

export async function promptForOutputPath(defaultPath) {
  if (!input.isTTY) return null;
  const rl = readline.createInterface({ input, output });
  try {
    const answer = (await rl.question(
      '保存 Excel 汇总到（直接回车：' + defaultPath + '；输入 skip 跳过保存）：\n> '
    )).trim();
    if (answer.toLowerCase() === 'skip') return 'skip';
    return answer || defaultPath;
  } finally {
    rl.close();
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let progressFile = null;
  let target = null;
  let noPrompt = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--output' || a === '-o') target = argv[++i] || null;
    else if (a === '--no-prompt') noPrompt = true;
    else if (!a.startsWith('-') && !progressFile) progressFile = a;
  }
  progressFile = progressFile || path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'out', 'apply-progress.json');
  if (!fs.existsSync(progressFile)) {
    console.error('找不到进度文件：' + progressFile);
    process.exit(2);
  }
  if (!target && noPrompt) {
    console.error('必须通过 --output <路径> 指定保存位置；未保存任何文件。');
    process.exit(3);
  }
  if (!target) {
    target = await promptForOutputPath(nextDefaultPath(progressFile));
    if (!target) {
      console.error('当前不是交互式终端。请先询问用户保存位置，再运行：');
      console.error('  node scripts/export-excel.mjs <进度文件> --output <路径> --no-prompt');
      process.exit(3);
    }
  }
  if (target === 'skip') { console.log('已跳过 Excel 导出。'); return; }
  const result = await exportProgress(progressFile, target);
  console.log('Excel 已保存：' + result.file + '（' + result.rows + ' 行）');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e.message || e); process.exit(1); });
}
