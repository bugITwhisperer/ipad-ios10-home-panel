# Decision log

Why the panel is built the way it is. One row per decision; newest section last.
When a decision is replaced, the old row stays and gets **Superseded by #N**.

---

## Foundations — weather, rotation, night mode

| #  | Decision | Why | Rejected alternative |
| -- | -------- | --- | -------------------- |
| 1  | One self-contained `index.html`, ES5 and old CSS only | iPad 4 (A1458) is stuck on iOS 10; its Safari rejects `let`, `=>`, `fetch`, CSS grid, `gap` | a framework or build step — nothing modern runs there |
| 2  | Weather from Open-Meteo, Lublin coordinates hardcoded | free, no API key, returns sunrise/sunset and timezone | APIs that need a key — a key cannot live in a public repo |
| 3  | Hosted on GitHub Pages from a public repo | static file, nothing to maintain, deploys ~60 s after a commit | own server |
| 4  | Views rotate 10 / 5 / 5 min (weather / list / calendar); a touch pauses rotation for 5 min from the last touch | weather is the most-read view; a touch means someone is reading | fixed equal slots |
| 5  | Night mode 00:30 → 5 min before sunrise; a touch gives 30 s of full UI | an always-lit panel in a dark room is too bright | fixed wake-up time — sunrise shifts through the year |
| 6  | Sunrise from the API is pinned to the current calendar day | a `sunrise` carrying another date darkened the screen in the evening | trusting the API date |
| 7  | Past hours disappear from the strip instead of being dimmed; the daily forecast starts tomorrow | nothing on screen that is already over; today is not shown twice | dimmed past hours |
| 8  | Full page reload daily at 04:00 with a `?v=timestamp` cache buster | the home-screen app never reloads on its own, so new code would never arrive | reload on a short interval |
| 9  | Light/dark theme toggle; dark by default; light is grey, not white | readable in daylight, easier on an old LCD; night mode always goes black on top | white light theme |
| 10 | Middle layer (n8n on Hetzner) for calendar and list data | private data needs authentication; no token in a public repo | — **Superseded by #11** |

---

## Shopping/ToDo — 2026-09-23

| #  | Decision | Why | Rejected alternative |
| -- | -------- | --- | -------------------- |
| 11 | Backend = Google Apps Script bound to the Sheet; the secret key lives only on the iPad (`localStorage`), never in the repo | no server, no OAuth, the page stays on GitHub Pages; the risk (someone with URL + key can read/tick the list) is accepted as very small | n8n on Hetzner (#10) — more moving parts and the page would have to move |
| 12 | Two lists, **Zakupy** and **ToDo**, in two tabs of one Sheet, shown as two columns | shopping and chores are read differently; editing stays in the Sheets app | one mixed list |
| 13 | A ticked item is struck through and hides after midnight (Europe/Warsaw); a second tap undoes it | mistakes can be undone the same day, the list cleans itself overnight | remove at once (no undo) / keep until cleaned by hand |
| 14 | The list is fetched only when the view opens (rotation or tab) | enough freshness, minimal traffic | polling every 1–5 min |
| 15 | 7 items per column, then `+N więcej`; a tap expands the column, it folds back when rotation resumes | fits the screen, the rest stays reachable and tickable | smaller font / scroll only / plain "+N" label |
| 16 | JSONP instead of XHR for Apps Script | tested on the real iPad first (spike page): XHR fails on CORS, JSONP works | XHR — ruled out by the test |
| 17 | Keep the Sheets "To-do list" template (checkbox in A, data from row 4); add column **D "Completed at"** filled by the script, also for items ticked in the Sheets app | checkboxes work natively in the Sheets app; no triggers needed for "hide after midnight" | own column layout / onEdit trigger |
| 18 | Key stored in Script Properties, created by `generateKey()`; rotating it = run again + new deployment version | nothing secret in code or repo; one-minute recovery if the URL leaks | key hardcoded in `Code.gs` |
| 19 | Web App access = **Anyone** (not "Anyone with Google account") | the home-screen app is not signed in to Google and got a login page instead of the list; access is protected by the key | "Anyone with Google account" |
| 20 | Validate the JSONP callback name, accept only a `…/exec?key=…` URL, strip whitespace from a pasted URL | no code injection through the callback; a pasted space broke setup once | accept any pasted URL |
| 21 | Item text is always escaped (shown as text, never HTML) | anyone who can edit the Sheet must not be able to inject markup | raw `innerHTML` |
| 22 | Long item text wraps onto more lines; columns use `flex: 1 1 0%` + `width: 0` | iOS 10 Safari ignores a bare `0` basis and long text pushed the ToDo column off-screen | ellipsis (`…`) — hid the end of tasks |
| 23 | No checkboxes on the iPad items — the whole row is the tap target, done = struck through | cleaner look; a large target is easier to hit on a wall | visual ☐/☑ boxes (tried in planning, dropped) |
| 24 | Setup screen button **Wyczyść** (clear the field) instead of **Anuluj** | "Anuluj" did nothing on first run — there was nothing to go back to | keep "Anuluj" |
| 25 | Storage key name `gscriptUrl` is frozen | renaming it would make every set-up iPad lose the saved address | renaming it to match the new folder name |
| 26 | Weather error keeps the last good data on screen; exactly one retry timer after 60 s | the old `fail()` crashed on missing elements and never retried | clearing the screen on error |
| 27 | Sheet time zone set to Warsaw (Berlin is equivalent) | stored times showed one hour off; the script already uses Europe/Warsaw for "midnight" | leave the default time zone |

---

## Repo and testing — 2026-09-23

| #  | Decision | Why | Rejected alternative |
| -- | -------- | --- | -------------------- |
| 28 | Plan → agree tests → tests red → implement → tests green | catches mistakes before they reach the iPad | code first, tests after |
| 29 | All tests in `tests/`, one command `node --test`; tests read `index.html` directly and set `TZ=Europe/Warsaw` themselves | no generated `panel-app.js`, no `TZ=` prefix, works the same in PowerShell | tests in the repo root next to generated files |
| 30 | Apps Script source kept in `apps-script/Code.gs` — the repo is the source of truth, pasted into the editor by hand | versioned and tested like the rest | editing only in the Google editor |
| 31 | Health-check pages in `health-check/` (`list.html`, later `cal.html`) | one place for connection checks, short URLs | files in the repo root (`diagnose-gscript-connection.html`) |
| 32 | Theme tests (group 12) kept and made green by merging the theme code into the Shopping/ToDo version | tests from an earlier session described code that had not reached the repo | marking them as TODO |
| 33 | A browser check at iPad size (1024×768, both themes) after every UI change | unit tests passed while a missing `}` switched off the whole light theme | unit tests only |
| 34 | README shows features, not stage letters (only the Roadmap table keeps them); this log is in English | the README describes what exists now; stage history lives here | stage letters throughout the README |

---

## Calendar — 2026-09-24

| #  | Decision | Why | Rejected alternative |
| -- | -------- | --- | -------------------- |
| 35 | Separate Google account for the panel (`puxle.home.panel`), invited to chosen events | only what is shared on purpose reaches the wall | reading Em's or Dorota's own calendars |
| 36 | Separate Apps Script project on that account (`apps-script/Calendar.gs`), second secret URL on the iPad (`gcalUrl`) | the script can only see the panel calendar; the list and calendar fail independently | calendar code in the Zakupy script with the panel calendar shared to Em's account — that script would get access to all of Em's calendars |
| 37 | Invitations: "Only if the sender is known" + E and D in the panel account's contacts | invites land without accepting, strangers' invites do not | "From everyone" |
| 38 | Tags by creator: E green, D blue, anyone else = login before `@`; E/D addresses live in Script Properties | who set it up is visible at a glance; no address in the public repo or in the response | full e-mail — too long for a 2 m read |
| 39 | Today: finished events stay struck through until midnight; overflow hides struck ones first | same feel as ticked items on the list; upcoming events never pushed out | removing them at once (like weather hours) |
| 40 | Same `Jutro / 3 / 5 / 7 dni` choice as the weather, but its own dropdown in the calendar view | familiar control; switching one view never changes the other | sharing the header dropdown |
| 41 | One fetch of 8 days when the view opens; the dropdown filters locally | one request per visit, instant dropdown | a request per dropdown change |
| 42 | Event past midnight shown on both days (`22:00–02:00`, then `do 02:00`); a day fully covered shows `cały dzień` | at 01:00 the running event must still be in "Dziś" | only on the start day |
