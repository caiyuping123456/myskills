# myskills

A collection of portable Agent Skills and standalone Chrome/Edge extensions.

## Layout

```
myskills/
├── skills/                    # Portable Agent Skills
│   └── <skill-name>/
│       ├── SKILL.md           # required entrypoint
│       ├── README.md          # optional docs
│       ├── agents/            # optional UI metadata
│       ├── scripts/           # optional executable helpers
│       └── references/        # optional supporting docs
└── chrome-extensions/         # Chrome / Edge extensions
    └── <extension-name>/
        ├── manifest.json      # Manifest V3
        ├── content/           # content scripts (panel UI)
        ├── lib/               # shared helpers
        └── icons/             # extension icons
```

## Skills

Each skill lives in its own folder under `skills/`. To add a new skill, create
`skills/<skill-name>/` and include a `SKILL.md` with `name` and `description`
frontmatter.

| Skill | Description |
|-------|-------------|
| [boss-job-apply](skills/boss-job-apply) | Automate BOSS直聘 job filtering and batch recruiter outreach through a logged-in browser. |

Install the same skill folder using your agent's discovery mechanism. See [multi-agent import instructions](skills/boss-job-apply/references/agent-compatibility.md). For example (Claude Code):

```powershell
Copy-Item -Recurse skills/boss-job-apply "$env:USERPROFILE\.claude\skills\boss-job-apply"
```

## Chrome Extensions

Each extension lives in its own folder under `chrome-extensions/`.

| Extension | Description |
|-----------|-------------|
| [boss-job-apply](chrome-extensions/boss-job-apply) | In-page floating panel on BOSS直聘 that filters jobs by company size and salary, then sends greetings in bulk. |

Load an extension unpacked in Chrome/Edge:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the extension folder, e.g. `chrome-extensions/boss-job-apply`

## CI / Releases

Two GitHub Actions workflows run automatically:

- **Lint** — validates every `.json` file and checks JavaScript syntax.
- **Package Extensions and Skills** — builds a browser-extension ZIP and a separate Agent Skill ZIP.
  - On push / PR: zips are uploaded as workflow artifacts.
  - On a `v*` tag: zips are attached to a GitHub Release.

Download a ready-to-install extension zip from the
[Releases](https://github.com/caiyuping123456/myskills/releases) page, then
unzip it and load the folder via `chrome://extensions`.

## Notes

- `.codex/` is ignored on purpose and must never be committed.
- Per-skill `config.json` and `out/` are gitignored so credentials and local
  results stay out of the repo.

## Download the correct package

- `boss-job-apply.zip`: Chrome/Edge extension; manifest.json at archive root.
- `skill-boss-job-apply.zip`: portable Agent Skill; extract the whole boss-job-apply folder for your coding agent. No Codex installation or OpenAI API is required. Local terminal/browser access is required.

### Agent import examples

| Client | Example user-level destination |
|---|---|
| Claude Code | `~/.claude/skills/boss-job-apply/` |
| Gemini CLI | `~/.gemini/skills/boss-job-apply/` |
| Codex | `~/.agents/skills/boss-job-apply/` |
| Other local agents | Import the whole SKILL.md folder, or explicitly read it and run scripts locally |

These are import paths, not a claim of end-to-end certification in each agent. See the skill compatibility guide for sources and limitations. Installed `.codex/`, `.claude/` and `.gemini/` directories are not modified by this change.


### Excel 投递汇总

`boss-job-apply` 在每轮投递结束后会生成 Excel 汇总（公司、岗位、薪资、城市、公司规模、学历要求、投递日期、状态、结果说明、岗位链接）。保存前会先询问保存位置；非交互式运行必须通过 `--excel <路径>` 指定，否则不会写文件。
