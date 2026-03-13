# Holiday Expense Tracker

A mobile-friendly web app for tracking shared holiday expenses across a group.
Real-time sync via Supabase — everyone sees changes instantly on their phone.

---

## Setup in ~10 minutes

### Step 1 — Create a free Supabase project

1. Go to https://supabase.com and sign up (free, EU region available)
2. Click **New project**, choose a name (e.g. "holiday-tracker"), pick **EU West** region
3. Wait ~2 minutes for the project to spin up

### Step 2 — Create the database table

1. In your Supabase project, go to **SQL Editor** → **New query**
2. Copy the entire contents of `supabase-schema.sql` and paste it in
3. Click **Run** — you should see "Success"

### Step 3 — Get your API credentials

1. Go to **Settings** → **API**
2. Copy your **Project URL** (looks like `https://xxxx.supabase.co`)
3. Copy your **anon / public** key (long string starting with `eyJ…`)

### Step 4 — Configure the app

1. In this folder, copy `.env.example` to a new file called `.env`
2. Fill in the two values:
   ```
   VITE_SUPABASE_URL=https://your-project-id.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...your-anon-key...
   ```

### Step 5 — Deploy to Vercel (free)

1. Go to https://vercel.com and sign up with GitHub
2. Push this folder to a GitHub repository (or use Vercel CLI)
3. In Vercel: **Add New Project** → import your repo
4. Under **Environment Variables**, add:
   - `VITE_SUPABASE_URL` → your project URL
   - `VITE_SUPABASE_ANON_KEY` → your anon key
5. Click **Deploy** — Vercel gives you a URL like `holiday-tracker.vercel.app`

### Step 6 — Share with the group

Send the URL to everyone. That's it — they open it in their phone browser,
tap "Who are you?", pick their name, and start adding orders.

---

## Running locally (for testing)

```bash
npm install
npm run dev
```

Then open http://localhost:5173

---

## How data is shared

Every device generates a unique **Trip ID** (shown as `#XXXXXX` in the header)
the first time the app is opened. All data is keyed to that ID in Supabase.

**Important:** all 15 people need to open the *same URL* — the trip ID is stored
in their browser's localStorage. If someone clears their browser data, they'll
get a new ID and see a blank app. To reconnect them, they can copy the trip ID
from someone else's device (future improvement: shareable trip codes).

---

## Privacy

- All data is stored in your own Supabase project in the EU region
- No third-party analytics or tracking
- The anon key only allows read/write to the `trip_data` table — nothing else
- Delete the Supabase project when the holiday is over and all data is gone

---

## Features

- **Name picker** — no passwords; each phone remembers who you are
- **Family groups** — group people for simplified settlement
- **Dinner events** — log who ate what, who paid, and optional tip
- **Add my order** — anyone can add their order to an existing event
- **Groceries** — split a shop equally among beneficiaries
- **Receipt scanning** — AI reads the photo and cross-references logged orders;
  unmatched items appear in a "To be assigned" list
- **Settle up** — per-person and per-family breakdown, minimised payment list
- **CSV export** — full summary spreadsheet
- **Real-time sync** — changes appear on all phones within seconds
