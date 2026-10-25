import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRows, HEADERS } from '../skills/boss-job-apply/scripts/export-excel.mjs';

const records = [
  { company:'A&B<科技>', title:'Java实习生', salary:'200-300元/天', city:'深圳', size:'20-99人', education:'本科', href:'/job_detail/x.html', outcome:'sent-verified', attemptedAt:'2026-10-25T03:00:00.000Z' },
  { company:'B', title:'Java开发', salary:'150-180元/天', city:'广州', size:'20-99人', education:'本科', skipped:'salary' },
  { company:'C', title:'Java开发', salary:'300-400元/天', city:'北京', size:'20-99人', education:'硕士', skipped:'education:硕士' },
  { company:'D', title:'Java开发', salary:'200-300元/天', city:'上海', size:'20-99人', education:'本科', skipped:'already-contacted' },
  { company:'E', title:'Java开发', salary:'200-300元/天', city:'杭州', size:'20-99人', education:'本科', skipped:'external-application-only' },
  { company:'F', title:'Java开发', salary:'200-300元/天', city:'成都', size:'20-99人', education:'本科', outcome:'ERROR', error:'tab-gone' },
  { company:'G', title:'Java开发', salary:'200-300元/天', city:'南京', size:'20-99人', education:'本科', wouldSend:'daily>=200' },
];

test('excel rows include required columns and map statuses', () => {
  const rows = buildRows({ results: records }, new Date('2026-10-24T00:00:00Z'));
  assert.equal(HEADERS.length, 11);
  assert.equal(rows.length, records.length);
  assert.deepEqual(rows[0].slice(0, 10), [1,'A&B<科技>','Java实习生','200-300元/天','深圳','20-99人','本科','2026-10-25','已投递（已确认）','']);
  assert.match(rows[1][8], /跳过（薪资）/);
  assert.match(rows[2][8], /跳过（学历）/);
  assert.equal(rows[3][8], '已沟通过');
  assert.equal(rows[4][8], '仅支持官网投递');
  assert.equal(rows[5][8], '失败');
  assert.equal(rows[6][8], '试运行（未发送）');
  assert.equal(rows[0][10], 'https://www.zhipin.com/job_detail/x.html');
});

test('missing attemptedAt falls back to progress file date', () => {
  const rows = buildRows({ results: [{ company:'X', title:'Java', outcome:'sent-unconfirmed' }] }, new Date('2026-10-20T10:00:00Z'));
  assert.equal(rows[0][7], '2026-10-20');
  assert.equal(rows[0][8], '已投递（未确认）');
});
