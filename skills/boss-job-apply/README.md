# boss-job-apply

A portable Agent Skill that automates **BOSS直聘 (zhipin.com)** job filtering and batch recruiter outreach, driving your own logged-in browser session.

## What it does

1. Collects job-detail links across configured cities and keywords.
2. Opens each job detail to read **company size** and **salary**.
3. Filters by your rules (company size range, daily pay floor, or campus monthly pay floor).
4. Clicks 立即沟通 and sends your greeting to the recruiter.
5. Writes resumable progress so you can stop and continue safely.

## Requirements

- Windows with Microsoft Edge
- Node.js 22+ (uses the built-in `WebSocket` and `fetch`)
- A BOSS直聘 account you log into yourself

## Quick start

```powershell
# 1. Launch a debuggable Edge window (dedicated profile)
powershell -ExecutionPolicy Bypass -File scripts/launch-edge.ps1

# 2. Log in to BOSS直聘 in the opened window, then:

# 3. Copy and edit the config
Copy-Item scripts/config.example.json scripts/config.json

# 4. Collect candidates
node scripts/collect-candidates.mjs scripts/config.json

# 5. Apply
node scripts/apply-jobs.mjs scripts/config.json
```

## Configuration

Edit `scripts/config.json`:

| Key | Meaning |
|-----|---------|
| `greeting` | Message sent to each recruiter |
| `targetCount` | Stop after this many successful sends |
| `cities` | BOSS city codes to search |
| `queries` | Search keywords |
| `titleInclude` | Title must contain one of these (case-insensitive) |
| `freshnessPattern` | Regex the card text must match (e.g. 2027/实习/校招) |
| `companySizeAllow` | Allowed company-size buckets |
| `dailyPayFloor` | Minimum daily pay |
| `campusMonthlyFloorK` | Minimum monthly pay for campus roles |
| `salaryMode` | `rangeMax` or `rangeMin` |
| `blockedCompanies` | Company names to skip (e.g. big tech) |

## Safety

- Never handles credentials; you log in yourself.
- Never bypasses captchas; it stops and hands back to you.
- Sending a greeting is irreversible — confirm text and filters before running.
- Progress is stored in `out/apply-progress.json`; re-running resumes.

## Notes

See `references/boss-dom-and-quirks.md` for the DOM structure, selectors, and
site-specific quirks (including why this uses raw CDP instead of Playwright).

## Multi-agent import

Download `skill-boss-job-apply.zip`, extract it and keep `boss-job-apply/SKILL.md`, `scripts/` and `references/` together. See [installation and client limitations](references/agent-compatibility.md) for Claude Code, Gemini CLI, Codex and other local agents. Optional `agents/openai.yaml` does not make the skill Codex-only. Import compatibility is not proof of local-browser execution in every client.

## Validation scope

The CLI currently filters size/salary, not education. Use the extension education panel or manually verify each job before outreach. Click-only delivery reporting and automatic retries are not evidence of a sent message; review the target conversation and exact outgoing text.


## Excel 投递汇总

每轮投递结束（或手动停止）后，Skill 会先询问 Excel 保存位置，再写入文件：

- 直接回车：保存到进度目录下的 `投递记录-YYYY-MM-DD.xlsx`
- 输入 `skip`：本次不导出
- 非交互式运行：必须显式传入 `--excel <路径>`，否则不会写文件

命令行：

```powershell
node scripts/apply-jobs.mjs scripts/config.json --excel "D:\桌面\投递记录-2026-10-25.xlsx"
node scripts/export-excel.mjs scripts/out/apply-progress.json --output "D:\桌面\投递记录-2026-10-25.xlsx" --no-prompt
```

表格列：序号、公司名称、岗位名称、薪资、城市、公司规模、学历要求、投递日期、投递状态、结果说明、岗位链接。

状态包括：已投递（已确认）、已投递（未确认）、未确认（聊天列表未找到）、失败、已沟通过、仅支持官网投递、试运行（未发送）、跳过（公司规模/学历/薪资）。

导出脚本不会读取浏览器 Cookie、账号密码或聊天内容，只读取本地 `apply-progress.json`。


## 安装包怎么选

- 安装 **Skill**：用 `skill-boss-job-apply.zip`（标准目录）或 `skill-boss-job-apply-flat.zip`（根目录 SKILL.md 兼容版）。
- 安装 **浏览器插件**：用 `chrome-extension-boss-job-apply.zip`，不要拿去安装 Skill。
- 如果 Skill 安装器报 `NO_SKILLS_IN_ZIP`，先确认没有误选 Chrome 插件包；仍失败则改用 flat 版。
