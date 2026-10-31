# Crucible: crew workout tracker

A clean, iPhone-first app for a training group that can't always lift together but does the same program.

- **Today:** the day's workout (exercise list, time, gym), a one-tap **Log this workout** button, and a crew check-in showing who has trained today and what time they posted.
- **Feed:** everyone's posts with notes, photos and videos. Each post is timestamped by the server when it's shared, so the time can't be faked. Tap 💪 to react, 💬 to comment.
- **Calendar:** month view with workouts, get-togethers and other events. Add events with an exercise list, optionally repeating weekly. Each day shows who trained.
- **Profiles:** after joining, each person fills in their own height, weight, maxes (bench, squat, deadlift, overhead press, pull-ups) and goals. Tap anyone to see their stats, goals, dated PR history and weigh-ins. Only you can edit your own.
- **Crew:** a lift board ranking everyone by each lift or Big 3 total, a weekly workout leaderboard with streaks, and the invite code to share.

It's a web app you install from Safari, so you don't need the App Store or an Apple developer account. Once added to the home screen it opens full-screen like a normal app.

---

## Try it now (demo mode)

With `config.js` left empty, the app runs in **demo mode**: a sample 9-person crew with a few weeks of workouts, stored only on your phone. Use it to get a feel for the app before setting up the real thing.

## Setup for your crew (about 15 minutes, free)

### 1. Create the database (Supabase, free tier)

1. Sign up at [supabase.com](https://supabase.com) and click **New project**. Pick any name and a database password.
2. When it finishes, open **SQL Editor → New query**, paste in all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
3. Go to **Authentication → Sign In / Providers → Email**. Turning **Confirm email** off makes signup instant for your crew. If you leave it on, each person confirms by email before they can sign in.
4. Go to **Project Settings → API** and copy the **Project URL** and the **anon public** key.

### 2. Connect the app

Open [`config.js`](config.js) and paste in the two values:

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOi...';
```

The anon key is designed to be public. Your crew's data is protected by the database rules in `schema.sql`, which only let people see their own crew's posts, photos and events.

### 3. Put it online (GitHub Pages, free)

1. In the repo on GitHub, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
2. After a minute the app is live at **`https://johnshort24.github.io/crucible/`**.

### 4. Install on iPhone

1. Open the link above in **Safari**.
2. Tap the **Share** button, then **Add to Home Screen**, then **Add**.
3. Open **Crucible** from your home screen, create an account, and tap **Start a new crew**.
4. On the **Crew** tab, tap **Share** to send the invite code to the guys. They follow the same steps and choose **Join a crew**.

## Day-to-day

- Whoever runs the program adds workouts on the **Calendar** (e.g. "Push Day" with one exercise per line, repeating weekly).
- Everyone taps the orange **+** after training to post notes plus photos and videos. Photos are resized automatically. Videos can be up to 50 MB, which is roughly a 30–60 second clip.
- The **Today** tab shows at a glance who has checked in.

## Files

| File | What it is |
|---|---|
| `index.html`, `styles.css` | Page shell and design (light and dark mode) |
| `app.js` | All screens and interactions |
| `data.js` | Talks to Supabase, or to on-device storage in demo mode |
| `config.js` | Your Supabase keys |
| `supabase/schema.sql` | Database tables, security rules, and photo/video storage |
| `manifest.webmanifest`, `sw.js`, `icons/` | Makes it installable as an app |

## Limits on the free tier

Supabase's free plan includes 1 GB of photo/video storage and 500 MB of database. A 9-person crew posting photos daily stays well within that for a long time. If you post a lot of video, the storage fills sooner. Inactive free projects are paused after a week with no use and can be resumed from the dashboard.
