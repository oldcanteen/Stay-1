# Stay

A Chrome side-panel companion for AI chats (ChatGPT, Claude, Gemini). Take
notes, sketch ideas, or play a quick mini-game while your AI is thinking.

## Dev

Load the extension unpacked:

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and point it at this folder.
4. Open any supported AI chat site (or `http://localhost`) and click the
   coral flower peeking from the right edge of the viewport.

The repo's `manifest.json` is set up for local dev — it also matches
`http://localhost/*` and `http://127.0.0.1/*` so you can test the edge
trigger on your own static pages. Those matches are stripped for the
store build (see below).

## Build the Chrome Web Store zip

```bash
./build-store-zip.sh
```

This produces `stay-<version>.zip` at the repo root. The script:

1. Reads the version from `manifest.json`.
2. Temporarily strips the `localhost` / `127.0.0.1` matches from the
   manifest (they raise reviewer questions and are dev-only).
3. Zips the project, excluding `.git/`, editor folders, `.DS_Store`,
   `test.html`, the store-facing `.md` files, and prior zips.
4. Restores your dev manifest.

Upload the resulting zip at
<https://chrome.google.com/webstore/devconsole>.

## Submission docs

- **`STORE_LISTING.md`** — all the copy you need to paste into the Dev
  Console (description, permission justifications, data-usage checkboxes).
- **`PRIVACY_POLICY.md`** — the privacy policy you need to host publicly
  and link to from the listing. See "Hosting the privacy policy" below.

### Hosting the privacy policy (one-minute GitHub Gist option)

1. Go to <https://gist.github.com>.
2. Filename: `stay-privacy-policy.md`.
3. Paste the contents of `PRIVACY_POLICY.md`.
4. Click **Create public gist**.
5. Click **Raw** on the gist page — copy that URL into the Dev Console's
   "Privacy policy URL" field.

### Publishing updates

1. Bump `"version"` in `manifest.json` (e.g. `2.0.0` → `2.0.1`).
2. `./build-store-zip.sh`
3. In the Dev Console, open the existing Stay item → **Package** tab →
   **Upload new package** → select the new zip → **Submit for review**.

Chrome's re-review for existing items is usually much faster (hours) than
the first-time review (1–3 business days).

## Repo layout

```
manifest.json          Chrome extension manifest (MV3)
background.js          Service worker — tab ↔ panel messaging, side-panel open
content.js             Content script — edge flower button + image paste
sidepanel.html         Side panel document
sidepanel.css          Side-panel-only overrides (sidepanel.html is the page)
sidepanel.js           Panel bootstrap + tab switching
styles.css             Shared component styles / design tokens
notes.js               Notes tab (per-chat notepad)
draw.js                Draw tab (vector canvas, Select artwork, Copy art)
game.js                Play tab (colour-match mini-game)
icons/                 Toolbar / action icons
build-store-zip.sh     Store packaging script
STORE_LISTING.md       Dev Console form copy
PRIVACY_POLICY.md      Policy to host publicly and link to
```
