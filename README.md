# AI Organizer

A personal organizer built around one idea: instead of a wall of lists, it shows you a single next move. Four sections (calendar, habits, tasks, and an Instagram tracker), plus AI buttons for meditation nudges, getting yourself unstuck, and pulling live reads from the web.

Built with Next.js, runs on Vercel, stores data in Upstash Redis, and uses Google Gemini for the AI features.

**Live demo:** https://ai-organizer-kappa.vercel.app/

> Heads up: the demo is one person's instance behind a password. To actually use it, run your own copy with your own free keys. The whole point is that it is yours. The steps below take about ten minutes.

## What it does

- **Next move:** a single line at the top that picks the one thing to do right now, based on the time, your unticked habits, your open tasks, and any event coming up. No list to stare at.
- **Calendar:** log what is happening today.
- **Habits:** tap to mark swim, gym, or meditation done, with a gentle streak that does not shame you for a missed day. A button asks the AI for a fresh, tiny way to start meditating.
- **Tasks:** dump everything personal and work, then "unstick me" reads your list and hands back one five minute first step plus a short push. A separate button pulls real, current reads from the web.
- **Insta:** log your follower count by hand to watch the trend, and get current content ideas and growth tactics pulled live.

## What is free and what is not

Everything here is free for personal use. Vercel hosting (Hobby plan), Upstash Redis (free tier), and the Google Gemini API free tier all cost nothing at this scale. A personal organizer will never come close to the limits.

Two honest caveats:

- On Gemini's free tier, Google may use your prompts to improve their models. Do not type anything sensitive into the AI buttons. Tasks and habits are low stakes, but worth knowing.
- Vercel's free Hobby plan is for non commercial use. A personal instance is fine. Turning this into a paid product would need their Pro plan.

## Bring your own keys

This project ships no keys, and you should never commit any. The repo includes a `.gitignore` that excludes `.env.local`, so your secrets stay off GitHub. Each person who runs this uses their own free Gemini key and their own free database. Nobody shares an owner's key.

## Run it locally (5 minutes)

1. Install Node 18 or newer.
2. In the project folder, run `npm install`.
3. Run `npm run dev`.
4. Open http://localhost:3000

It boots with no setup. At this stage data saves in memory only.

### Turn the AI buttons on locally 

1. Copy `.env.example` to a new file named `.env.local`.
2. Get a free key at https://aistudio.google.com/app/apikey and paste it after `GEMINI_API_KEY=`. No credit card needed.
3. Restart `npm run dev`. Search grounding for the reads buttons is built in, nothing extra to enable.


## Framework

- `app/page.jsx` the whole interface.
- `app/api/state` loads and saves your data.
- `app/api/ai` talks to Gemini, with the key kept on the server, never in the browser.
- `app/api/auth` the password check.
- `lib/store.js` the data layer (Upstash, with an in-memory fallback for local testing).
- `app/globals.css` the look.

## Limitations

- The calendar is manual. Google Calendar sync is a possible future phase.
- Instagram numbers are entered by hand. No app, including this one, can read Instagram's ranking algorithm. Pulling your own stats automatically would need an Instagram Business account and the Graph API, a later phase.
