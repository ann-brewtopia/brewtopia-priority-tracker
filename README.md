# Priority Tracker — Website Version

## What this is

The real-website port of the Claude-artifact Priority Tracker, built against
Supabase (database + auth) instead of Claude's `window.storage` bridge.

## Login page — what changed and why

Three real problems showed up on the live deployment, in order:

1. **The page had no styling at all.** It was loading `css/styles.css` as a
   separate file, and that file wasn't loading on Vercel.
2. **An expired magic-link click landed on a blank form with no
   explanation.** Fixed by reading the error Supabase puts in the URL and
   showing an actual message.
3. **Every one of the four JS files 404'd on the live deployment**
   (`supabase-client.js`, `auth.js`, `data.js`, `app.js` all came back
   "Not Found" in the browser console) — meaning literally none of the
   app's code was running. Every button on the page was dead: clicking a
   tab did nothing, submitting the login form did nothing, because there
   was no JavaScript there to respond to either.

After the *second* separate-file-404 incident, this stopped being treated
as two unrelated one-off deployment quirks and became a decision: **this
project is now a single self-contained `index.html` file.** Every script
that used to live in `js/*.js` is inlined directly inside it (clearly
labeled with banner comments so it's still readable), the same way the CSS
was already inlined, the same way the original Claude-artifact version of
this tool worked the whole time without ever hitting this class of bug.
**There is no more `js/` folder.** If you're looking at an older clone with
one, delete it — it's not used anymore.

The tradeoff: `index.html` is a big file now (a few thousand lines). That's
a deliberate, informed choice — reliability over tidy file separation for
a small internal tool, given this exact category of bug has now broken the
login page twice in a row.

On top of those three fixes, **added per request:** email + password login
as the default tab (magic link kept as a second tab), a **Remember me**
checkbox that's a real setting (controls whether the session survives a
browser restart, not decorative), and a "Forgot / set password" flow —
necessary because every account so far was created via magic link only,
which never sets a password, so there was nothing for the password field
to check against until this exists.

**One bug specifically worth knowing about, since it was subtle:** the
first version of the password-reset flow showed the "set a new password"
form correctly, but had no real session behind it — a password-reset link
carries its session token in the URL, and the code was reading then
immediately erasing that URL before Supabase's own client got a chance to
read the token itself. Fixed by switching to Supabase's own
`PASSWORD_RECOVERY` event instead of manually parsing the URL.

**Ported and working:** sign-in (password + magic link), Home (Team P1s +
Follow-Ups), Daily Priorities (ticket cards, flagging to P1, due dates,
status, per-day schedule), the KPI tab (department tabs, seniority sorting,
per-week notes, name search, real privacy — admin sees everyone, a person
sees only their own row once explicitly shared, everyone else doesn't see
the tab exists), and real-time updates across browsers.

**Not yet ported — deliberately, not accidentally:** Compact view, History,
Users tab, Help tab, and linking a priority to a follow-up. These were left
for a follow-up pass rather than written blind, since there's no live
Supabase project to actually test any of this against yet. Once this is
deployed and the core loop is confirmed working for real, porting the rest
is mechanical — the pattern is already established in `app.js`/`data.js`.

**One rough edge in the KPI admin tools worth knowing about:** linking a
KPI row to someone's real account currently works by pasting in a raw user
ID from a plain text list (via a `prompt()` popup) rather than a proper
searchable dropdown. It's functional, not polished — a fine target for a
later cleanup pass, not something to treat as finished design.

**I have not run this against a real Supabase project.** I can't — one
doesn't exist yet. Treat this as a strong first draft that needs real testing
once deployed, the same way you'd treat any code from a contractor before it
touches production data.

## One-time setup

### 1. Supabase
1. Create a project at supabase.com.
2. Project → SQL Editor → paste in `supabase_schema.sql` → Run.
3. Project Settings → API → copy the **Project URL** and **anon public key**.
4. Paste those into `js/supabase-client.js` (the two `YOUR_...` placeholders).
5. Authentication → Providers → make sure Email is on. This one setting
   covers both magic link and password sign-in — nothing extra to enable
   for password login specifically.
6. Authentication → URL Configuration → add your Vercel URL (and
   `http://localhost:3000` for local testing) to the redirect allow-list.
   **This step matters more now** — it's also where password-reset and
   "set your first password" links get redirected back to.

### 2. First admin
Have Dennis and Ann each sign in once through the app (this creates their
account — password tab, then "Forgot / set password" the first time since
they won't have one yet). Then in the SQL Editor:
```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'dennis@onlybrewtopia.com');
```

### 3. GitHub
Push this whole folder to a new repo. It's just four files now:
`index.html`, `supabase_schema.sql`, `vercel.json`, `README.md`. No `js/`
or `css/` folders — if you have an old clone with those, delete it and
re-clone rather than merging, to avoid stale files confusing a future
deploy.

### 4. Vercel
1. New Project → Import the GitHub repo.
2. Framework preset: "Other" (this is a static site, no build step).
3. Deploy. Every push to `main` after this redeploys automatically.

## Local testing before deploying
Any static file server works, e.g. from this folder:
```
npx serve .
```
Then open the printed `localhost` URL. (Opening `index.html` directly via
`file://` won't work — Supabase's auth redirect needs a real `http://` origin.)

## Data migration from the old version
Nothing automatic yet. The old Claude-artifact tracker's data lives in
Claude's storage, not here — carrying over existing tickets/P1s/follow-ups
means either re-entering them once this is live, or a one-time export script
(ask for this specifically if it's needed — it's a separate small task).

