# Setting up When the Beat Drops

This guide gets the app live on the internet so Molly can open it on her phone. No coding is needed. Plan for about an hour, most of it spent creating accounts.

You'll need the accounts below (GitHub is already set up) and copy a few "keys" between them. Keep a notes file open to paste things into as you go.

| What | Why | Cost |
|---|---|---|
| **Spotify** (Molly's account, **Premium**) | The app reads her playlists and saves songs | Her existing Premium |
| **GitHub** | Stores the app's files | Free |
| **Vercel** | Runs the app on the web | Free (Hobby plan) |
| **Anthropic** (Claude) | The AI that picks the songs | Pay as you go. About 5 to 15 cents per search |
| **GetSongBPM** | Real BPM numbers | Free |

> **Important Spotify rule.** Spotify now only lets "personal" apps like this one be used by up to **5 people**, and the account that creates the app **must have Spotify Premium**. If that Premium lapses, the app stops working. The simplest setup is for **Molly to create the Spotify app with her own Premium account** (Step 3). Then nothing else needs adding.

---

## Step 1. The app's files on GitHub (already done)

The code is already in your GitHub repository: **github.com/jakewarbu-wq/when-the-beat-drops**. There's nothing to do here. Any change pushed to that repository later goes live automatically once Step 2 is done.

## Step 2. Put the app online with Vercel

1. Go to **vercel.com** and click **Sign Up**. Choose the **Hobby** plan and **Continue with GitHub**.
2. Click **Add New…**, then **Project**.
3. Find `when-the-beat-drops` in the list and click **Import**. (If it isn't listed, click **Adjust GitHub App Permissions** and allow Vercel to see that repository. Make sure you signed in to Vercel with the GitHub account that owns the repository, `jakewarbu-wq`.)
4. Leave **Framework Preset** as **Other** and don't change any other settings. Click **Deploy**.
5. When it finishes, click **Continue to Dashboard**. Under **Domains** you'll see the app's address, something like `when-the-beat-drops.vercel.app`.

Write down the full address with `https://` in front and **a slash at the end**, for example:

```
https://when-the-beat-drops.vercel.app/
```

This is your **app address**. You'll need it in the next steps. (If you open it now you'll see an "Almost there" message. That's expected.)

## Step 3. Create the Spotify app

Do this logged in as **Molly's** Spotify account (the one with Premium).

1. Go to **developer.spotify.com/dashboard** and log in. Accept the developer terms if asked.
2. Click **Create app** and fill in:
   - **App name:** When the Beat Drops
   - **App description:** Personal spin class music finder
   - **Website:** your app address
   - **Redirect URI:** your app address, **exactly**, including `https://` and the slash at the end, e.g. `https://when-the-beat-drops.vercel.app/`. Click **Add**.
   - **Which API/SDKs are you planning to use?** Tick **Web API**.
3. Tick the terms box and click **Save**.
4. Click **Settings**. Copy the **Client ID** into your notes. (You do **not** need the Client secret.)

**If you created the Spotify app with your own account instead of Molly's:** your account must have Premium, and you must add Molly. In the app, open **Settings**, then **User Management**. Enter her name and the email address she uses for Spotify, then click **Add user**.

## Step 4. Get the AI key (Anthropic)

1. Go to **console.anthropic.com** and sign up.
2. Open **Billing** (under Settings) and add credit. $10 is plenty to start; one search costs roughly 5 to 15 cents.
3. Recommended: under **Limits**, set a monthly spend limit (for example $20) so there are never surprises.
4. Open **API Keys** and click **Create Key**. Name it `beat drops`.
5. Copy the key (it starts with `sk-ant-`) into your notes. **It's only shown once.** Treat it like a password.

## Step 5. Get the BPM key (GetSongBPM)

This is optional. Without it, the app still works but every BPM shows as an AI estimate labelled "approx."

1. Go to **getsongbpm.com/api**.
2. Fill in the form:
   - **Website URL:** your app address
   - **Backlink URL:** your app address again. (GetSongBPM requires a link back to their site. The app already shows "BPM data from GetSongBPM.com" at the bottom of every page, so you're covered.)
   - **Email:** your email
3. Submit, then open the email they send and follow the link to activate your key. Copy the key into your notes.

## Step 6. Give the keys to Vercel

1. In Vercel, open your project and go to **Settings**, then **Environment Variables**.
2. Add each of these. For each one, type the **Key** exactly as shown (capital letters and underscores), paste the **Value**, leave all environments ticked, and click **Save**.

| Key | Value |
|---|---|
| `SPOTIFY_CLIENT_ID` | The Client ID from Step 3 |
| `ANTHROPIC_API_KEY` | The `sk-ant-…` key from Step 4 |
| `GETSONGBPM_API_KEY` | The key from Step 5 (skip if you don't have one) |

3. Go to the **Deployments** tab. Click the **⋯** next to the top deployment and choose **Redeploy**, then **Redeploy** again. Keys only take effect after a redeploy.

## Step 7. First login, then lock it to Molly

1. Open your app address on Molly's phone and tap **Log in with Spotify**. Approve the permissions.
2. Tap the round button in the top-right corner (her initial or photo), then **Copy Spotify ID**.
3. Back in Vercel (**Settings**, then **Environment Variables**), add one more:

| Key | Value |
|---|---|
| `ALLOWED_SPOTIFY_USER_IDS` | The Spotify ID you just copied |

4. Redeploy again (Step 6, point 3).

This means only Molly's Spotify account can use the AI and BPM features, so nobody who stumbles on the address can spend your Anthropic credit. To allow a second person later, put both IDs in, separated by a comma.

## Step 8. Put it on her home screen

- **iPhone (Safari):** open the app, tap the **Share** button, then **Add to Home Screen**.
- **Android (Chrome):** open the app, tap the **⋮** menu, then **Add to Home screen**.

It then opens full-screen like a normal app.

---

## How Molly uses it

- **Similar:** tick one or more of her playlists and tap **Find similar songs**. She gets 10 to 20 songs she doesn't already have in those playlists, each with a reason.
- **Remix:** pick a past class playlist. Tap **Swap** on any song to get a few suggestions that fit the same spot in the ride (she can add a hint like "more 90s"). Use **↑ ↓** to reorder and **✕** to remove. **✨ Freshen every song** replaces the whole list with new songs that keep the same shape. **Save as new playlist** saves it as a new playlist; the original is never changed.
- **Ask:** type anything, like "90s dance anthems for a hill climb" or "a 45-min class: warm-up, 3 climbs, sprint finish, cool-down". Class requests come back as an ordered setlist grouped by section, with the total running time and a few spare songs at the end.
- Each song shows **BPM** (marked "approx." when it's an AI estimate), **length**, an **energy** bar from 1 to 10, and class tags like Climb or Sprint.
- **▶ Spotify** opens the song in the Spotify app. **+ Add** saves it to a new or existing playlist. **✕** dismisses it so it won't be suggested again (with an Undo).
- **Save all to a playlist** saves the whole list, or the whole class in order.
- **Filters** set a BPM range, song length and clean-only.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| "Almost there" message | `SPOTIFY_CLIENT_ID` is missing or misspelled in Vercel. Fix it and redeploy. |
| Spotify says **INVALID_CLIENT: Invalid redirect URI** | The Redirect URI in the Spotify app doesn't exactly match the app address. Check `https://`, the spelling, and the slash at the end. |
| Spotify login works but the app says it can't load playlists, or Spotify shows a "not registered" / 403 message | The person logging in isn't the Spotify app's owner and hasn't been added under **User Management** (Step 3). Or the owner's Premium has lapsed. |
| "This Spotify account isn't allowed to use this app" | The ID in `ALLOWED_SPOTIFY_USER_IDS` doesn't match. The message shows the right ID; copy it into Vercel and redeploy. |
| "The AI key isn't set up yet" | Add `ANTHROPIC_API_KEY` and redeploy. |
| Searches fail with a server error | Check Anthropic **Billing** still has credit, and that the key wasn't deleted. |
| Every BPM says "approx." | Check `GETSONGBPM_API_KEY` is set and was activated from their email. Some songs simply aren't in their database. |
| A playlist she follows isn't in the list | Spotify only lets personal apps read playlists she created or collaborates on. In Spotify, open that playlist, tap **⋯**, then **Add to other playlist** to copy it into a new playlist of her own. |

**Making changes later:** any change to the GitHub repository (by you, or by asking Claude in this project) redeploys automatically within a minute or two.

**Optional settings** (add as Environment Variables, then redeploy):

- `AI_EFFORT`: `low` (default, fastest), `medium` or `high` (more thoughtful picks, slower and a little pricier).
- `AI_MODEL`: which Claude model to use. Default `claude-opus-5-5`.
