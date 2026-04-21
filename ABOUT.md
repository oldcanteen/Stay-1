# Stay

A lightweight Chrome side-panel companion for AI chats. Slide Stay in from
the edge of the screen and use the time productively while ChatGPT, Claude,
or Gemini is busy thinking.

## What it does

Stay lives in Chrome's native side panel and gives you three small tools,
plus an always-visible flower button that peeks from the edge of any
supported AI chat tab.

- **Notes** — A per-conversation notepad. Type, paste, or drag in any text
  or image from the page. Notes are bucketed by chat, so one conversation's
  notes never bleed into another.
- **Draw** — A minimal sketch canvas with pen, eraser, text, shapes, and
  five colours. Hit *Select artwork → Copy art* and the image drops
  straight into the chat's composer, ready to send.
- **Play** — A 20-second colour-matching mini-game to keep you focused
  while the model streams. Stay quietly flags when the answer is ready.

## Private by design

Stay has no backend. Nothing you type or draw is ever sent to a server.
Everything is stored locally via `chrome.storage.local`. No trackers,
no analytics, no ads.

## Works with

- `chatgpt.com` / `chat.openai.com`
- `gemini.google.com`
- `claude.ai`

Requires Chrome 116+ (for the native side-panel API).

## Project structure

| File / folder         | Purpose                                                  |
| --------------------- | -------------------------------------------------------- |
| `manifest.json`       | Chrome extension manifest (MV3)                          |
| `background.js`       | Service worker — tab ↔ panel messaging, side-panel open  |
| `content.js`          | Content script — edge flower button + image paste        |
| `sidepanel.html`      | Side-panel document                                      |
| `sidepanel.css`       | Side-panel-only style overrides                          |
| `sidepanel.js`        | Panel bootstrap + tab switching                          |
| `styles.css`          | Shared component styles / design tokens                  |
| `notes.js`            | Notes tab (per-chat notepad)                             |
| `draw.js`             | Draw tab (vector canvas, Select artwork, Copy art)       |
| `game.js`             | Play tab (colour-match mini-game)                        |
| `icons/`              | Toolbar / action icons                                   |
| `build-store-zip.sh`  | Chrome Web Store packaging script                        |
| `STORE_LISTING.md`    | Chrome Web Store Dev Console submission copy             |
| `PRIVACY_POLICY.md`   | Public-facing privacy policy                             |
| `README.md`           | Developer setup and release instructions                 |

## Permissions and why

| Permission                        | Reason                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `sidePanel`                       | Renders the Stay UI inside Chrome's native side panel.                                         |
| `scripting`                       | Injects the edge-trigger flower button onto supported AI chat pages.                           |
| `activeTab`                       | Reads the active tab's URL to bucket notes by conversation and paste art into the composer.    |
| `storage`                         | Persists notes, drawings, and UI state locally via `chrome.storage.local`.                     |
| `clipboardWrite`                  | Copies a drawing to the clipboard as a PNG so the user can paste it into the chat composer.    |
| Host perms (chat sites)           | Lets the edge-trigger content script run on the supported AI chat sites.                       |

## Getting started (dev)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and point it at this folder.
4. Open a supported AI chat site and click the coral flower on the right
   edge of the viewport.

For packaging a Chrome Web Store build, see `README.md`.

## Status

Current release: **v2.0.0** — side panel UI, Notes / Draw / Play tabs, and
a draggable edge bookmark.
