# BOSS直聘 DOM structure and site quirks

Hard-won details for driving zhipin.com. Update this file when the site changes.

## Why raw CDP instead of Playwright

`chromium.connectOverCDP()` followed by `browser.close()` **closes the user's pages**.
BOSS's anti-automation then ends the session, and the tab collapses to `about:blank`.
Always talk to the browser with raw CDP over the WebSocket URL from
`http://127.0.0.1:9222/json/list`:

- Open a work tab: `PUT /json/new?<url-encoded-url>`
- Close it: `GET /json/close/<tabId>`
- Evaluate: `Runtime.evaluate` with `returnByValue: true, awaitPromise: true`

Do not navigate the user's primary tab. If `Runtime.evaluate` returns
`Inspected target navigated or closed`, the click caused a navigation — re-read
`/json/list` and continue against the new tab state.

## Page inventory

| Page | URL | Notes |
|------|-----|-------|
| Job search | `/web/geek/jobs?city=<code>&query=<kw>` | Main list + filters |
| Job detail | `/job_detail/<id>.html` | Company size + salary + 立即沟通 |
| Chat | `/web/geek/chat` | Conversation list + message input |
| Resume | `/web/geek/resume` | Online resume |

The 校园 (`/school/`) nav entry **redirects to the home page** for logged-in users.
Do not rely on it; use job-search URLs directly.

## Job list

- Card container: `.job-card-box`
- Card inner text lines: `[title, salary, (schedule/duration/education), company, location]`
- Detail link: the `<a>` inside the card, e.g. `/job_detail/xxxx.html`

## Company-size filter is not scriptable

The 公司规模 filter (`.condition-filter-select`) is a hover-only Vue dropdown.
Scripted `.click()` on the current-select or the `<li>` options does **not** apply
it, and the `scale=` URL param is ignored. **Read company size from each job-detail
page instead** — it appears in the "公司基本信息" block as one of:
`0-20人`, `20-99人`, `100-499人`, `500-999人`, `1000-9999人`, `10000人以上`.

## Job detail

- Chat button: `a.btn-startchat` (two of them, same label). Labels:
  - **立即沟通** — not contacted yet; clicking it sends the greeting
  - **继续沟通** — this recruiter was already contacted
  - **立即网申** — external application form; there is **no** chat button on
    this page at all, so the job cannot be messaged
- Company size: matched from body text via the size regex above
- Salary: `300-400元/天`, `200元/天`, or `10-15K`
- Education: exact label from the header tag list
  (`学历不限|初中及以下|中专/中技|高中|大专|本科|硕士|博士`). Do not read it from
  the description body, and treat more than one match as unknown.

Clicking 立即沟通 **navigates that same tab** to `/web/geek/chat` and may spawn a
second chat tab.

## Sending: 立即沟通 sends immediately

**Clicking 立即沟通 is the send.** It delivers the account's saved default
greeting without any confirmation step or typing. Verified over a 100+ job run:
there is no text box involved in the normal path.

Consequences to design around:

- `config.greeting` does **not** control the text. The wording comes from the
  account's saved greeting in the BOSS app. Check they match before a run, or
  the script will silently send something else.
- Do not "fix" a failed send by typing into the chat and clicking send — that
  would deliver a **second** message to a recruiter who already got one.
- Treat `继续沟通` as already done. Clicking it only opens the existing chat.

## Chat page: the editor only exists after selecting a conversation

- Conversation rows: `li[role="listitem"]` (40 per page load). **Not**
  `.chat-user-list li` — that selector matches nothing.
- Each row's text: `HH:MM <recruiter><company><role> [送达|已读|未读] <preview>`
- With no conversation selected — the default state after page load — there is
  **no message editor in the DOM at all** (`[contenteditable]` count is 0,
  `textarea` count is 0). Scripted and CDP mouse clicks on a row were both
  observed to do nothing, so do not rely on selecting a conversation
  programmatically.
- The three `iframe` elements on the page are 0×0 `about:blank` placeholders.
  The chat UI is in the main document; frame targeting is unnecessary.

Editor structure, if a conversation is ever open (selectors confirmed present on
the page while a recruiter has an active thread):

- Input: `div.chat-input[contenteditable="true"]` — a contenteditable div, **not**
  a `textarea`. The old `textarea.input` selector matches nothing.
- Send button: `button.btn-send`, carrying `disabled` in its class list until the
  editor has content.

Typing, if genuinely needed, must use `execCommand('insertText')` plus an
`input` event so the framework registers the change:

```js
el.focus();
document.execCommand('insertText', false, message);
el.dispatchEvent(new InputEvent('input', { bubbles: true, data: message, inputType: 'insertText' }));
```

## Verifying delivery

A click is not proof. Confirm against the conversation list:

1. Reload the chat tab (`location.reload()`) so the list is fresh.
2. Find the row for the company (`li[role="listitem"]` text contains the name).
3. Require a `[送达]` or `[已读]` marker in that row.

Match on the full company name where possible. BOSS rows often drop suffixes
(`有限公司`, `科技`), and short fragments collide across companies — a 2-character
fragment will match unrelated rows.

Companies already contacted under a **different job posting** do not get a new
row; the button may still read 立即沟通 while no new conversation appears. Record
these as `UNVERIFIED-not-in-list` rather than resending.

## Blocking by company name does not work on its own

Brands post under legal entity names, so a blocklist of brand strings misses
them. Observed misses: 拼多多 jobs listed under 上海从鲸信息技术; 阿里巴巴 jobs
under 淘宝, 天猫, 蚂蚁集团. Also worth blocking separately: outsourcing
suppliers such as 中软国际, 中科软, 太极股份.

Keep both an exact-name list (`blockedCompanies`) and a regex list
(`blockedCompanyPatterns`) and test against company **plus** job title.

## Rate limiting and risk control

- Keep ~5-6s between opening a job detail and interacting, and ~250-800ms between jobs.
- The site periodically closes automation tabs. Treat that as a signal to slow down
  or stop, not to retry aggressively.
- Never run this against more than the user's agreed target count in one pass.
- Stop and hand back to the user on any captcha, login prompt, or blank page.

## City codes (BOSS直聘)

```
深圳 101280600   广州 101280100   杭州 101210100   北京 101010100
上海 101020100   成都 101270100   南京 101190100   武汉 101200100
长沙 101250100   西安 101110100   合肥 101220100   厦门 101230100
重庆 101040100   青岛 101120100   郑州 101180100   天津 101030100
苏州 101190200   宁波 101210200   东莞 101281000   南昌 101240100
```
