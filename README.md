# AI Organizer

Your personal organizer. Four sections (calendar, habits, tasks, insta), a single "next move" line so you are never staring at a wall of obligations, and AI buttons for meditation nudges, unsticking yourself, and live reads. Built with Next.js, runs on Vercel, stores your data in Upstash Redis, and uses Google Gemini for the AI buttons.

## What is free and what is not

Everything here is free for personal use. Vercel hosting (Hobby plan), Upstash Redis (free tier), and the Google Gemini API free tier (1,500 requests a day, no credit card) all cost nothing at this scale. A personal organizer will never come close to those limits.

One honest caveat on Gemini: on the free tier Google may use your prompts to improve their models, so do not type anything sensitive into the AI buttons. Your tasks and habits are low stakes, but worth knowing.

## Run it on your laptop first (5 minutes)

1. Install Node 18 or newer if you do not have it.
2. In this folder, run `npm install`.
3. Run `npm run dev`.
4. Open http://localhost:3000

It boots with no setup. Data saves in memory only at this stage, so it resets when you restart the server. That is expected. The real database comes in the deploy step.

## Turn the AI buttons on (optional, local)

1. Copy `.env.example` to a new file named `.env.local`.
2. Get a free key at https://aistudio.google.com/app/apikey and paste it after `GEMINI_API_KEY=`. No credit card needed.
3. Restart `npm run dev`. That is it. Search grounding for the reads buttons is built in, there is nothing extra to switch on.

## Deploy to Vercel (this is where data becomes permanent)

1. Put this folder on GitHub (new repo, push it).
2. Go to https://vercel.com, click New Project, import that repo. Accept the defaults and deploy.
3. Add the database. In your Vercel project, open the Storage tab, add the Upstash (Redis) integration from the Marketplace. Vercel injects `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` for you automatically.
4. Add your other environment variables in the project Settings under Environment Variables:
   - `GEMINI_API_KEY` (your free key from Google AI Studio)
   - `APP_PASSWORD` (any password you like, to lock the app)
5. Redeploy so the new variables take effect.

That is it. Your organizer is live at your Vercel URL, your data persists in Upstash, and it is locked behind your password.

## A few honest notes

- Security is light by design. The password gate is fine for a personal tracker. Do not store anything truly sensitive in it.
- If you leave `APP_PASSWORD` blank, the app is open to anyone with the link.
- Calendar is manual for now. Real Google Calendar sync is a separate, bigger piece we can add next.
- Instagram numbers are entered by hand. Nobody, including this app, can read Instagram's ranking algorithm. Pulling your own stats automatically would need an Instagram Business account and the Graph API, which is a later phase.

## What lives where

- `app/page.jsx` the whole interface.
- `app/api/state` loads and saves your data.
- `app/api/ai` talks to Gemini (your key stays on the server, never in the browser).
- `app/api/auth` the password check.
- `lib/store.js` the data layer (Upstash, with an in-memory fallback for local testing).
- `app/globals.css` the look.
