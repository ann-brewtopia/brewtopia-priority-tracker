# Priority Tracker — Website Version

## What this is

The real-website port of the Claude-artifact Priority Tracker, built against
Supabase (database + auth) instead of Claude's `window.storage` bridge.

## Login page — what changed and why

Two real problems showed up on the first live deploy, both fixed now:

1. **The page had no styling at all.** It was loading `css/styles.css` as a
   separate file over a `<link>` tag, and that file wasn't loading on the
   live Vercel deployment — could be a path issue, a Vercel config quirk,
   who knows exactly. Rather than chase the specific cause, the whole
   stylesheet is now **inlined directly into `index.html`**, the same way
   the original Claude-artifact tracker worked (a single self-contained
   file). There's no longer a `css/` folder — there's nothing external left
   to fail to load. If you want to edit styles going forward, edit the
   `<style>` block at the top of `index.html` directly.
2. **An expired magic-link click just landed on a blank form with no
   explanation.** Supabase reports that failure in the URL itself
   (`#error=access_denied&error_code=otp_expired...`), and nothing was
   reading it. The login screen now checks for that on load and shows an
   actual message ("that link expired — request a new one") instead of
   silence.

**On top of that, added per your ask:** a proper email + password login is
now the default tab, with a **Remember me** checkbox that's a real setting,
not decorative — checked keeps you signed in across browser restarts,
unchecked signs you out once the tab/browser closes. Magic link is still
there as a second tab for anyone who prefers it. There's no separate
"username" field — email is the identifier, same as it always was; adding
a disconnected username system would just be a second source of truth for
the same person, worth flagging as a deliberate choice rather than an
oversight.

**One catch worth knowing:** anyone who has only ever used the magic link
has no password set yet. The "Forgot / set password" link on the password
tab handles that — it sends the same kind of reset email either way,
Supabase doesn't distinguish "reset" from "set for the first time."

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
Push this whole folder to a new repo. Note there's no `css/` folder anymore
— just `index.html`, `js/`, `supabase_schema.sql`, `vercel.json`, this file.

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

