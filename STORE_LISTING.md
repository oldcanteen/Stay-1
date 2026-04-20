# Chrome Web Store — Submission Copy

Copy-paste this into the Dev Console fields. One block per form field.

---

## 1. Store listing tab

### Item name
```
Stay
```

### Summary (max 132 characters)
```
Notes, doodles, and a quick mini-game in Chrome's side panel — for while your AI chat is thinking.
```

### Detailed description
```
Stay is a lightweight side-panel companion for AI chats.

Waiting for ChatGPT, Claude, or Gemini to finish a long answer? Slide Stay
in from the edge of the screen and use the time productively — jot notes
that stay tied to the conversation, sketch ideas on a quick canvas, or
play a tiny colour-matching mini-game to stay sharp.

What's inside

• Notes — A per-conversation notepad. Type, paste, or drag in any text
  or image from the page. Everything is bucketed by chat, so your notes
  for one conversation never bleed into another.

• Draw — A minimal sketch canvas with pen, eraser, text, shapes, and
  five colours. Drop in any artwork with a single click — "Select
  artwork" → "Copy art" and the image is dropped straight into your
  chat's composer, ready to send.

• Play — A 20-second colour game to keep you focused while the model
  streams its answer. Stay quietly lets you know when it's done.

• An always-visible flower button that lives on the edge of your chat
  tab. One click opens the side panel; no shortcut to memorise.

Private by design

Stay has no backend. Nothing you type or draw is ever sent to us — or
anyone. Everything lives locally in Chrome's own extension storage.
There are no trackers, no analytics, no ads.

Works with

• chatgpt.com
• chat.openai.com
• gemini.google.com
• claude.ai

Requires Chrome 116+ (for the native side-panel API).
```

### Category
Productivity

### Language
English

### Screenshots
Provide 3–5 PNG or JPG images at 1280×800 (preferred) or 640×400.
Suggested shots:

1. Notes tab with two or three real notes in it, side-by-side with ChatGPT.
2. Draw tab mid-sketch, with the coral "Copy art" button armed at the bottom.
3. Play tab with the colour grid active.
4. The edge flower button peeking out on a ChatGPT page.
5. The "Your answer is ready" badge appearing during the Play tab.

### Small promotional tile (required for featuring)
440 × 280 PNG. Typically the flower icon + wordmark on a coral/ink background.

---

## 2. Privacy tab

### Single purpose
```
A side-panel companion for AI chat sites (ChatGPT, Claude, Gemini) that lets users take notes, doodle, and play a quick mini-game while waiting for an answer.
```

### Permission justifications

- **`sidePanel`**
  ```
  Renders the Stay UI (notes, draw, play tabs) inside Chrome's native side panel.
  ```

- **`scripting`**
  ```
  Injects a small, always-visible edge-trigger button onto supported AI chat pages so users can open the side panel from the page without using the toolbar.
  ```

- **`activeTab`**
  ```
  Reads the URL of the active AI-chat tab to bucket notes by conversation, and pastes drawings the user has captured into that tab's chat composer when they click "Copy art".
  ```

- **`storage`**
  ```
  Persists notes, drawings, and UI state between browser sessions via chrome.storage.local. Nothing is synced or sent off-device.
  ```

- **`clipboardWrite`**
  ```
  Copies a drawing from the Draw tab to the system clipboard as a PNG image so the user can paste it into the chat composer.
  ```

- **Host permissions (chatgpt.com, chat.openai.com, gemini.google.com, claude.ai)**
  ```
  Required for the edge-trigger content script to run on the supported AI chat sites. The script only adds a small button and relays the open-side-panel event to the extension background — it does not read or modify chat content.
  ```

### Data usage form — tick these

- [ ] I do NOT collect or use user data   → **leave UNCHECKED** (Stay stores
      user-typed notes locally, which counts as collection)

Check the boxes saying Stay collects:
- [x] **Personal communications** (the notes users type)
- [x] **Website content** (text or images dragged in from the page)

Then certify:
- [x] I do not sell or transfer user data to third parties.
- [x] I do not use or transfer user data for purposes unrelated to the
      item's single purpose.
- [x] I do not use or transfer user data to determine creditworthiness
      or for lending purposes.

### Privacy policy URL
Publish `PRIVACY_POLICY.md` somewhere public (see README.md for a one-click
option using GitHub Gist) and paste that URL here.

---

## 3. Distribution tab

- **Visibility:** Public
- **Regions:** All regions
- **Pricing:** Free
