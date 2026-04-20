# Privacy Policy — Stay

_Last updated: April 20, 2026_

Stay is a Chrome extension that adds a side-panel companion to AI chat sites
(ChatGPT, Claude, Gemini) so you can take notes, doodle, and play a quick
mini-game while waiting for an answer.

This policy explains exactly what data Stay touches and what it does with it.

## Data we collect

Stay stores the following **on your device only**, in
`chrome.storage.local`:

- **Notes you type or drag into the Notes tab.**
- **Drawings you create in the Draw tab.**
- A small amount of context used to group your notes (the URL / chat
  identifier of the tab the note was made from, and the most recent prompt
  you sent in that chat, so the note is filed under the right conversation).
- Minor UI preferences (which tab was active, panel dimensions, etc.).

Stay also temporarily handles:

- **Text or images you drag from a page into the panel**, in order to insert
  them into a note. This data is never sent anywhere; it lives only inside
  the note until you delete it.
- **Images copied from the Draw canvas to your clipboard** when you use
  "Select artwork" or "Copy art", so you can paste them into the chat.

## Data we do NOT collect

- Stay does **not** send anything to Stay's developers or any third party.
- Stay does **not** have a backend server.
- Stay does **not** use analytics, telemetry, crash reporting, or
  fingerprinting.
- Stay does **not** include any ads or trackers.
- Stay does **not** read or store the content of AI chat conversations
  beyond the small snippet described above (chat id + most-recent-prompt,
  used only for local organisation).
- Stay does **not** sell, trade, or transfer any user data.

## Where your data lives

All data lives in Chrome's local extension storage
(`chrome.storage.local`), which is sandboxed to your browser profile on
your device. Uninstalling Stay removes it. If you use Chrome Sync, the
storage bucket is **not** synced — Stay only uses the `local` bucket.

## Permissions explained

Stay requests the following Chrome extension permissions. Each is used
solely for the functionality described; no data leaves your browser.

- **`sidePanel`** — to render the Stay UI inside Chrome's native side panel.
- **`scripting`** / **`activeTab`** — to inject a small edge-trigger button
  onto supported AI chat pages, read the page URL so notes can be grouped
  by conversation, and paste drawings into the active chat composer when
  you click "Copy art".
- **`storage`** — to persist your notes and drawings locally between
  browser sessions.
- **`clipboardWrite`** — to copy a drawing as a PNG image to the system
  clipboard so you can paste it into the chat.
- **Host permissions** for `chatgpt.com`, `chat.openai.com`,
  `gemini.google.com`, and `claude.ai` — required for the edge-trigger
  content script to run on those sites.

## Children's privacy

Stay is not directed at children under 13 and does not knowingly collect
information from them.

## Changes to this policy

If this policy changes, the "Last updated" date at the top will change too,
and the new version will be published at the same URL you are reading now.

## Contact

Questions or concerns? Reach out via the Chrome Web Store listing's
"Support" tab, or email the address listed on the store page.
