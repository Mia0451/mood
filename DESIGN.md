# mood — Design Document (as built)

> **Status:** Live at <https://mood.app.space> · SDK `deepspace@0.44.2` · App id `app_01M8B4MPZYCZS5QTH6D0AG6FXN`
> **Supersedes:** `design_doc.md` (the original proposal). Where they differ, this document describes what is actually implemented and why.

---

## 1. Overview

**mood** is a real-time social web app. A signed-in person says (or types) how they feel; the app turns that sentence into an AI-generated image and posts it into one shared, live **public room**. Anyone can watch the room. Signed-in people can react to other people's images and open a **private 1:1 chat** from any image, where they can exchange text, voice notes, and privately generated images.

### Goals

- One live public feed that updates for every viewer without refresh.
- Zero-to-minimal AI spend: a quota-aware provider router with a free fallback, per-user daily caps, and a mock provider for all local development.
- Privacy enforced on the server (Durable Object read policies and a gated media route), never only in the UI.
- Images are immutable for users (no delete); only an admin can take one down.

### Stack

| Layer | Technology |
| --- | --- |
| Frontend | Vite + React 19, React Router 7 with file-based routes (generouted), Tailwind v4, Base UI primitives (`src/components/ui`), lucide icons |
| Backend | Hono app on a Cloudflare Worker (`worker.ts`) |
| Data | DeepSpace `RecordRoom` Durable Object (SQLite), real-time sync over WebSocket |
| Files | DeepSpace platform file storage (shared R2, per-app namespaced) via `appFiles` / `/api/files` |
| Auth | DeepSpace auth worker (Better Auth), Google OAuth |
| AI | DeepSpace integration proxy (`gemini/generate-image`), optional direct provider keys |
| Hosting | DeepSpace (Cloudflare Workers for Platforms) at `mood.app.space` |

---

## 2. Users, roles and capabilities

DeepSpace resolves a role per connection: signed-out sockets are `viewer` (with `'*'` as the permission fallback), signed-in users are `member` by default, and the app owner is pinned to `admin`.

| Capability | Signed-out visitor | Signed-in member | Admin (app owner) |
| --- | --- | --- | --- |
| App bar | `Log In` | Account link (avatar, name, unread badge) + `Log Out` | same as member |
| View public room | ✅ live feed, infinite scroll | ✅ | ✅ |
| Author identity on images | Masked ("Someone in the room", generic icon) | Google name + avatar | same |
| Like / Dislike | ❌ (counts visible only) | ✅ on **other people's** images | ✅ |
| Voice/typed generation | ❌ (composer hidden) | ✅ (daily cap) | ✅ |
| Chat from an image | ❌ | ✅ (any other user's image) | ✅ |
| Take an image down | ❌ | ❌ | ✅ any image |
| `/account` | Sign-in panel | Generations + Chats tabs | same |
| `/chat/:roomId` | Sign-in panel | Only if a participant | Only if a participant (admins cannot read others' chats) |

Sign-in uses `<AuthOverlay providers={['google']} />`. The overlay always also shows an email/password field; on the platform that path is used only by `@deepspace.test` test accounts.

---

## 3. Features

### 3.1 Public room (`/`)

- Chronological feed (newest first) of image cards: author header, square image, quoted transcript, like/dislike counts, relative time.
- **Live**: new images, reactions and takedowns appear for all viewers immediately via the RecordRoom WebSocket.
- **Infinite scroll (best-effort)**: `useQuery` supports `limit` but no cursor, so an `IntersectionObserver` sentinel raises the limit by 20 when the bottom nears.
- **Image menu** (signed-in, on hover/focus; tap to toggle on touch):
  - Others' images: **Like**, **Dislike**, **Chat**.
  - Own images: no menu.
  - Admins: additionally **Take down** (with a confirmation dialog) on any image.
- **Composer** (signed-in only, sticky bottom):
  - **Voice**: click the mic; the browser Web Speech API transcribes one utterance and stops on silence; the transcript is submitted **as heard — not editable** (product decision).
  - **Typed fallback**: shown on browsers without speech recognition (e.g. Firefox) or when the user chooses "type it instead". Max 500 characters.
  - While generating, the composer shows *Painting "…"*; errors and the daily-limit message appear as toasts.

### 3.2 Reactions

- One reaction per user per image; **toggle** semantics: same button again clears it, the other button switches it.
- Self-reactions are refused by the server; signed-out users cannot react.
- Counts are stored on the image record (denormalised) so the feed never has to load every reaction.
- A member's own current reaction is highlighted (members can read only their own reaction rows).

### 3.3 Private 1:1 chat (`/chat/:roomId`)

- **Opening**: `Chat` on another user's image calls `openChat`, which finds or creates the pair's room. The room id is deterministic — `dm_<idA>_<idB>` with ids sorted — so the same two people always share one room.
- **Context card**: the first message is a **`system` message** showing the clicked image and its transcript ("Bob started a chat from your mood …"). It is *not* a fabricated message from the other person. Re-opening from the **same** image adds no duplicate card; opening from a **different** image of the same person adds a new card in the same room.
- **Anyone can DM anyone** by chatting from their public image (product decision; no blocking/consent step yet).
- **Message types**:
  - `text` — up to 2,000 characters.
  - `voice` — recorded in the browser with `MediaRecorder` (WebM/Opus, Ogg or MP4 depending on browser), click to start/stop, auto-stop at 60 s, max 1.5 MB.
  - `image` — **private painting**: the voice/typed composer inside the chat generates an image that is visible only to the two participants, **never posted to the public room**, and **counts toward the daily cap**.
  - `system` — context cards (above).
- **Unread badges**: each room keeps an `unread` map (`userId → count`). Sending bumps the peer's count; opening the chat clears your own. The total appears on the Account link in the app bar, and per room in the chat list.
- Outsiders see "Chat not found" (the server never confirms whether a room exists).

### 3.4 Account page (`/account`)

Protected by the `(protected)` route group. `?tab=chats` selects the second tab.

- **Generations tab**: a sticky **date rail** (`DD/MM/YYYY`, viewer's local timezone, newest first) beside a grid of the user's **public** images grouped by day. Clicking a tile opens a **lightbox** with zoom in / zoom out / reset (100–400 % in 50 % steps; `+`/`-`/`Esc` keys). **No delete actions.** Taken-down images show "Taken down by a moderator". (Private chat paintings live in their chats, not here.)
- **Chats tab**: the user's rooms sorted by `lastMessageAt` descending, with the peer's Google avatar and name, last-message preview ("You: …" for your own), relative time and an unread badge. Clicking navigates to `/chat/:roomId`.

### 3.5 Admin takedown

- Admin-only action (owner id or `resolveAppRole(...) === 'admin'`).
- Sets the image's `status` to `removed` — it disappears from the room for everyone except its owner and admins — **and deletes the stored file**, because public-scope file URLs are world-readable and would otherwise keep serving.
- No prompt filtering for now (product decision).

### 3.6 Static page (`/about`)

A provider-free page (no auth fetch, no WebSocket) prerendered to static HTML at build with title, description and canonical URL, and listed in `sitemap.xml`. It exists so crawlers and link previews get real content, since `/` is a live, client-rendered page.

---

## 4. Product decisions log

| # | Question | Decision | Rationale |
| --- | --- | --- | --- |
| D1 | Image providers | Mock + DeepSpace proxy (`gemini/generate-image`); Google / OpenAI / Meta slots activate only when a key is set | Works with no provider accounts; mock keeps dev free |
| D2 | Anonymous reactions | **Signed-in only** | Anonymous ids are random per WebSocket connection and fingerprints are spoofable, so "one vote per visitor" is unenforceable |
| D3 | Author masking for signed-out viewers | Hide names/avatars; accept that opaque user ids exist in record envelopes | RecordRoom has no field-level read projection; the users roster is already empty for anonymous sockets |
| D4 | First chat message | `system` context card, not a message "from" the other user | Never fabricate speech by another person |
| D5 | Who can DM | Anyone, via Chat on a public image | Low friction; revisit with blocking if abused |
| D6 | Unread badges | Yes — per-room `unread` map | Cheap: no need to load every room's messages |
| D7 | Private-chat paintings | Private only; count toward the daily cap | Privacy + spend control |
| D8 | Moderation | Admin takedown; no prompt filter for now | Simple, sufficient at current scale |
| D9 | Transcript editing | Not editable before generation; typed fallback available | Keeps the "speak and see" feel |
| D10 | Feed paging | Best-effort infinite scroll by raising `limit` | SDK has no cursor on `useQuery` |
| D11 | Counts | Denormalised `likeCount`/`dislikeCount` on the image | Avoids loading all reactions |
| D12 | Dates | Viewer's local timezone (`DD/MM/YYYY`) | Matches user expectation |
| D13 | Users collection | Keep scaffold `read: 'own'`; names via `useUsers()` / `useUserLookup()` | `read: true` would expose emails |
| D14 | Write path | **All** app-collection writes go through server actions; clients have `create/update/delete: false` | RecordRoom has no write-validation hooks, so business rules (self-vote, membership, caps, immutability) live in actions |
| D15 | Usage reset | Counters keyed by period (`provider:YYYY-MM`, `user:YYYY-MM-DD`) | No cron needed |
| D16 | `/` vs landing | `/` is the live room; static landing moved to `/about` | Room must be dynamic; keep a prerendered SEO page |
| D17 | Source control | DeepSpace cloud repo (latched permanently at first deploy) | Default per project AGENTS.md; no GitHub requested |

---

## 5. Architecture

```
Browser (React)                                   Cloudflare Worker (worker.ts, Hono)
──────────────                                    ───────────────────────────────────
pages/(app)/_layout.tsx                           /api/auth/*         → auth worker (Better Auth)
  DeepSpaceAuthProvider                           /ws/*               → RecordRoom DO (live sync)
  RecordProvider allowAnonymous ──WebSocket──────▶ AppRecordRoom (SQLite, RBAC per collection)
  RecordScope app:<APP_ID>                        /api/actions/:name  → src/actions/* (RBAC-off tools)
                                                     │  tools.create/get/update/query → RecordRoom
useQuery / useUserLookup  (reads)                    │  tools.integration('gemini/generate-image') → API worker
runAction() ──POST Bearer JWT───────────────────▶   │  appFiles(env, {scope}) → platform file storage
<img src=/api/files/…?scope=app>  ──────────────▶ /api/files/*        → platform worker (public reads)
<img|audio src=/api/media/dm/:id> (cookie) ─────▶ /api/media/dm/:id   → membership check → appFiles(self).download
```

### Key principle: reads are live, writes are actions

- **Reads** use `useQuery` over the RecordRoom WebSocket. The DO filters rows by the caller's role and the collection's read policy **before** sending, so private rows never reach outsiders.
- **Writes** go through `POST /api/actions/<name>` with the caller's Bearer JWT. Actions run with RBAC off (`X-App-Action`), so each one authorizes explicitly (ownership, membership, admin, caps) before writing.

---

## 6. DeepSpace integration

### 6.1 Project layout and routing

| Path | Purpose |
| --- | --- |
| `src/pages/_app.tsx` | Root shell (no data providers) |
| `src/pages/about.tsx` | Static, prerendered page (`/about`) |
| `src/pages/(app)/_layout.tsx` | Auth + `RecordProvider allowAnonymous` + `RecordScope`; mounts `TopBar` |
| `src/pages/(app)/index.tsx` | Public room (`/`) |
| `src/pages/(app)/(protected)/_layout.tsx` | `AuthGate` with an in-app sign-in panel |
| `src/pages/(app)/(protected)/account.tsx` | `/account` |
| `src/pages/(app)/(protected)/chat/[roomId].tsx` | `/chat/:roomId` |
| `src/pages/[...all].tsx` | 404 |
| `src/prerender-entry.tsx` | Lists prerendered pages (`/about`) |
| `src/server/http-routes.ts` | Scaffold auth/files/proxy routes; OAuth completion now lands on `/` |

Route groups in parentheses don't appear in URLs. `(app)` supplies auth and live data; `(protected)` additionally requires sign-in.

### 6.2 Collections (`src/schemas/*`, registered in `src/schemas.ts`)

All collections live in the single app scope `app:<APP_ID>`. "Action-only" means every client role has `create/update/delete: false`.

#### `users` (scaffold, unchanged)
`read: 'own'` for members; the directory comes from `useUsers()`/`useUserLookup()` (public identity: id, name, imageUrl, role). Anonymous sockets receive no directory.

#### `public_images` — action-only
| Column | Type | Notes |
| --- | --- | --- |
| `ownerId` | text, required, immutable | `ownerField` |
| `r2Key` | text | stored key in the **app** (public) file scope |
| `imageUrl` | text | serving path, used directly as `<img src>` |
| `promptTranscript` | text, ≤ 500 | |
| `inputMode` | select `voice`/`typed` | |
| `providerUsed` | text | which router provider produced it |
| `likeCount`, `dislikeCount` | number, default 0 | maintained by `react` |
| `status` | select `live`/`removed`, default `live` | `visibilityField: { field: 'status', value: 'live' }` |

Read: `'*'`, viewer, member → `'published'` (live rows, plus the owner's own removed rows); admin → all.

#### `image_reactions` — action-only
`imageId`, `actorId` (`ownerField`), `type` (`like`/`dislike`). Record id `imageId:actorId`; `uniqueOn: ['imageId','actorId']`. Read: member `'own'`, admin all, signed-out none.

#### `private_rooms` — action-only
`participants` (JSON array, immutable, `collaboratorsField`), `lastMessageAt`, `lastMessagePreview` (≤ 140), `lastSenderId`, `unread` (JSON map). Record id `dm_<a>_<b>`. Read: member/admin `'shared'` (participants only); viewer/`'*'` none.

#### `private_messages` — action-only
`roomId`, `participants` (JSON, `collaboratorsField`), `senderId`, `type` (`text`/`voice`/`image`/`system`), `content` (text, or the file key in the **sender's private** scope), `imageRefId`/`imageRefUrl`/`imageRefTranscript`/`imageRefOwnerId` (system-card snapshot), `durationMs`, `transcript`. Read: `'shared'` for participants only.

#### `provider_usage`, `generation_usage` — admin-read, action-write
- `provider_usage`: id `provider:YYYY-MM`, `count`.
- `generation_usage`: id `userId:YYYY-MM-DD` (UTC), `count`.

#### `settings` (scaffold, admin-only, unused by mood)

### 6.3 Server actions (`src/actions/*`, `POST /api/actions/<name>`)

All require a signed-in caller (Bearer JWT; 401 otherwise). Responses are `{ success: true, data }` or `{ success: false, error, code? }`.

| Action | Params | Authorization & rules | Effect |
| --- | --- | --- | --- |
| `generateMood` | `transcript`, `inputMode` | Transcript 1–500 chars; daily cap | Router → upload to `appFiles({scope:'app'})` at `moods/<id>.<ext>` → create `public_images` row |
| `react` | `imageId`, `type` | Image exists & live; caller ≠ owner (`self_reaction`) | Create/switch/remove reaction (`imageId:userId`); update counts |
| `takedownImage` | `imageId` | Admin only (`forbidden`) | `status = removed`; delete the public file |
| `openChat` | `imageId` | Image live; caller ≠ owner (`self_chat`) | Find/create `dm_…` room; add a system card once per image |
| `sendMessage` | `roomId`, `text` | Caller is a participant (`not_found` otherwise); 1–2,000 chars | Message + room `last*` + peer unread +1 |
| `sendVoice` | `roomId`, `audioBase64`, `mimeType`, `durationMs` | Participant; audio MIME allow-list; ≤ 1.5 MB; ≤ 60 s | Upload to sender's `self` scope `dm/<room>/<msg>.<ext>`; voice message |
| `generateInChat` | `roomId`, `transcript`, `inputMode` | Participant; daily cap | Router → upload to sender's `self` scope → image message |
| `markRead` | `roomId` | Participant | Caller's unread count → 0 |

Shared generation core: `src/actions/generation.ts` (`generateForUser`, daily cap, usage store).

### 6.4 Custom worker route

`GET /api/media/dm/:messageId` (`src/server/media-routes.ts`, registered after the action routes in `worker.ts`):

1. Identify the caller: Bearer JWT, else `resolveSessionReadAuth` (same-origin session cookie, so `<img>`/`<audio>` work). Otherwise **401**.
2. Load the message RBAC-off; require the caller to be in `participants` and the type to be `voice`/`image`. Otherwise **404**.
3. Stream `appFiles(env, { scope: 'self', userId: senderId }).download(content)` with `Cache-Control: private` and `nosniff`.

This exists because `'self'` file scope is readable only by the uploader, while `'app'` scope is world-readable — neither fits "exactly two people".

### 6.5 File storage

| Content | Scope | Key | Served via |
| --- | --- | --- | --- |
| Public images | `app` (world-readable) | `moods/<imageId>.<png/jpg/webp>` | `/api/files/apps/<APP_ID>/moods/…?scope=app` |
| Private paintings | `self` of the sender | `dm/<roomId>/<messageId>.<ext>` | `/api/media/dm/<messageId>` |
| Voice notes | `self` of the sender | `dm/<roomId>/<messageId>.<webm/ogg/m4a/mp3>` | `/api/media/dm/<messageId>` |

- Plan allocation: **1 GiB** for the app (owner's plan). Gemini images are ~1–1.5 MB each, so roughly 700–1,000 images; mock images ~20 KB.
- The platform refuses active content types (HTML/SVG/JS); the mock therefore emits PNG.
- Only takedown deletes files; users cannot.

### 6.6 Authentication

- `DeepSpaceAuthProvider` + `RecordProvider allowAnonymous` so signed-out visitors can read the public room.
- Google sign-in through the platform's auth worker; profile name and avatar come from the users roster (`imageUrl`).
- OAuth completion redirects to `/` (changed from the scaffold's `/home`).
- Identity in actions and the media route comes only from a verified JWT or session cookie — never from request params.

### 6.7 Integrations (`src/integrations.ts`)

- `gemini/generate-image` via `tools.integration(...)` from server actions. Billing defaults to **developer** (owner's DeepSpace credits). Request `{ prompt, aspectRatio: '1:1' }`; response `base64Images[]` (data URIs). Approx. cost ≈ $0.05 per image at the listed paid-tier rate.
- Scaffold entries `google: user` and `composio: user` remain (per-user API connections; not used for sign-in).

### 6.8 Environment and secrets

| Name | Where | Purpose |
| --- | --- | --- |
| `IMAGE_PROVIDER_ORDER` | `wrangler.toml [vars]` = `deepspace,google,openai,meta,mock` | Deployed provider order |
| `IMAGE_PROVIDER_ORDER_DEV` | optional var | Local order; **defaults to `mock` only** |
| `DAILY_IMAGE_LIMIT` | optional var | Per-user daily cap (default 5 deployed, 50 locally) |
| `GOOGLE_API_KEY`, `OPENAI_API_KEY`, `META_API_KEY`, `META_IMAGE_MODEL` | `npx deepspace secrets set …` | Enable direct providers |
| `ALLOW_DEBUG_ROUTES` | set by `deepspace dev/test` | Used to detect local runs |
| `OWNER_USER_ID`, `APP_OWNER_JWT`, `APP_IDENTITY_TOKEN`, … | platform-managed | Scaffold/platform wiring |

Secrets are never hand-edited into `.dev.vars` (it is regenerated on every dev/test/deploy run).

### 6.9 Durable Objects

Unchanged scaffold manifest: `RECORD_ROOMS` (all mood data), plus `YJS_ROOMS`, `CANVAS_ROOMS`, `PRESENCE_ROOMS`, `CRON_ROOMS` (no tasks), `JOB_ROOMS` (no jobs). mood uses only the RecordRoom.

---

## 7. Image generation router

`src/ai/image-router.ts` + `src/ai/providers.ts`

```ts
interface ImageProvider {
  name: 'deepspace' | 'google' | 'openai' | 'meta' | 'mock'
  monthlyFreeLimit: number
  apiKeyEnvVar?: string
  isConfigured(ctx): boolean
  generate(prompt, ctx): Promise<{ bytes: Uint8Array; mimeType: string }>
}
```

**Algorithm** (`routeImage`): for each provider in order → skip if not configured → skip if this month's `provider_usage` ≥ `monthlyFreeLimit` → try `generate`; on success increment usage and return; on failure record it and continue. **`mock` is always appended last**, so generation never fails for lack of keys, credits or quota.

| Provider | Monthly cap | Enabled when | Call |
| --- | --- | --- | --- |
| `deepspace` | 300 | integration proxy available (server actions) | `gemini/generate-image` |
| `google` | 100 | `GOOGLE_API_KEY` | Gemini `gemini-2.5-flash-image:generateContent` |
| `openai` | 50 | `OPENAI_API_KEY` | `images/generations`, `gpt-image-1`, low quality |
| `meta` | 500 | `META_API_KEY` | Together `images/generations` (default `FLUX.1-schnell-Free`, override `META_IMAGE_MODEL`) |
| `mock` | ∞ | always | 256×256 PNG: prompt-seeded gradient + glow orb, deterministic |

**Prompt**: `An evocative, painterly image expressing this mood: "<transcript>". no text, no words, no letters, no writing, no logos` (the suffix prevents gibberish lettering).

**Spend controls**, in order: sign-in required → per-user daily cap (5) → per-provider monthly cap → free mock fallback. Local dev/test is mock-only unless explicitly configured.

**Speech-to-text** runs in the browser (Web Speech API) at zero server cost. Voice notes in chats are stored as audio, not transcribed.

---

## 8. Security and privacy model

| Threat | Mitigation |
| --- | --- |
| Client forges/edits/deletes images, reactions, messages | Client `create/update/delete: false` on all app collections; all writes via actions |
| Self-voting | `react` compares the caller with `ownerId` |
| Double voting | Deterministic id + `uniqueOn` |
| Reading someone else's chat | `'shared'` read policy on `participants`, enforced in the DO before broadcast |
| Posting into someone else's room | Every chat action re-checks membership; outsiders get `not_found` |
| Fetching private media by URL | `/api/media/dm/:id` checks membership; 401 signed-out, 404 outsider |
| Spoofed identity | Identity only from a verified JWT or same-origin session cookie |
| Email leakage | `users` stays `read: 'own'`; UI uses the public-identity roster |
| Credit drain | Sign-in, daily cap, monthly provider caps, mock fallback |
| Taken-down image still reachable | Takedown deletes the public file |

**Known accepted exposures:** record envelopes carry opaque `createdBy` user ids (D3). Public-scope images are world-readable by URL by design.

---

## 9. Testing

Run with `npx deepspace test run all` (Playwright, local dev server, mock provider) and `npm run validate` (tsc + Vitest).

**Unit (Vitest, 26 tests)**
- `src/ai/image-router.test.ts` — order resolution, quota skip, failure fall-through, unconfigured skip, deterministic valid PNG, data-URI decoding.
- `src/actions/react.test.ts` — toggle/switch maths, self-reaction refusal, removed/unknown images, one reaction per user, counts in step.
- `src/actions/takedown.test.ts` — non-admin refused, owner allowed.
- `src/actions/chat.test.ts` — deterministic room id, room reuse, one system card per image, self-chat refusal, unread bump/clear, outsiders refused without confirming existence, payload validation.
- Uses `src/actions/fake-tools.ts`, an in-memory `ActionTools`.

**End-to-end (Playwright)**
- `tests/smoke.spec.ts` — static `/about` contract (no auth fetch, no WebSocket, SEO tags), signed-out room, gated `/account` and `/chat/*`, 404.
- `tests/api.spec.ts` — auth proxy, WebSocket boot.
- `tests/collab.spec.ts` — two distinct signed-in identities; signed-in composer and account page.
- `tests/feed.spec.ts` — typed mood → live image for author and another user; served file loads; masked author for signed-out; 401 for signed-out action.
- `tests/reactions.spec.ts` — live like/switch/clear across two users; no menu on own image; no controls signed-out.
- `tests/private-chat.spec.ts` — three users: chat from image, context card, unread badge set/cleared, live replies, private painting visible to both participants and **not** in the public room, outsider sees "Chat not found" and gets 404 on media, signed-out gets 401; account date rail + lightbox zoom.

Test accounts: `mood-alice@`, `mood-bob@`, `mood-carol@deepspace.test` (passwords stored locally by the CLI).

**Not covered by automation:** real Gemini/Google/OpenAI/Meta calls, Web Speech recognition and `MediaRecorder` in a real browser, the takedown UI end-to-end (test accounts are not admins). The scaffold's `/api-status` debug test is timing-sensitive under parallel load.

---

## 10. Operations

```bash
npx deepspace dev start          # local (mock provider only)
npx deepspace test run all       # full Playwright suite
git commit …                     # DeepSpace source: deploy requires a clean, committed tree
npx deepspace deploy             # → https://mood.app.space
npx deepspace logs --follow --json
npx deepspace app files list     # storage used vs plan allocation
npx deepspace app usage          # credits / integration spend
npx deepspace releases           # ledger; `rollback` if needed
npx deepspace secrets set OPENAI_API_KEY=…   # enable a direct provider (then redeploy)
```

- **Source authority:** DeepSpace cloud repo (latched permanently at the first deploy).
- **Local uploads hit real storage:** `deepspace dev` uses the real platform file service, so local generations consume the app's file allocation (mock images are ~20 KB).
- **Changing the cap or order:** edit `wrangler.toml [vars]` (`IMAGE_PROVIDER_ORDER`, `DAILY_IMAGE_LIMIT`) and redeploy.

### 10.1 Inspecting and cleaning up production data

`npx deepspace agent tools/invoke` calls the app's agent tools **as the logged-in CLI user** (the owner is admin). The built-in `records_*` tools still obey each collection's RBAC, so they can read everything an admin can read but **cannot delete** mood data — every mood collection has `delete: false` for all roles by design.

**Inspect** (repeat per collection: `public_images`, `image_reactions`, `private_rooms`, `private_messages`, `generation_usage`, `provider_usage`):

```bash
npx deepspace agent tools mood --json                 # discover tools + input schemas
echo '{"collection":"public_images","limit":500}' > q.json
npx deepspace agent invoke mood records_query --input-file q.json --json
```

Admins see all `public_images` and usage rows, but only chats they participate in (`'shared'` read policy).

**Delete stored files** (public app scope; one key per call):

```bash
npx deepspace app files list --json                   # keys + storage used
npx deepspace app files rm moods/<imageId>.png
npx deepspace app files list --private                # your own private folder only
npx deepspace app files rm <key> --private
```

Files in *other users'* private folders (chat media) are not reachable from the CLI; they can only be deleted by worker code via `appFiles(env, { scope: 'self', userId }).delete(key)`.

**Full reset of records and their files** (used once on 2026-11-26 to clear the launch play session). Because no role can delete records, the reset is a temporary, admin-only agent tool that runs RBAC-off through the same `createActionTools` the server actions use:

1. Restore the tool from history and deploy it (DeepSpace source requires a committed tree):
   ```bash
   git show 1b63a5e -- src/ai | git apply     # adds src/ai/purge-tool.ts, registers it in buildTools
   git commit -am "TEMP: admin-only purge tool"
   npx deepspace deploy
   ```
   `admin_purge_mood_data` refuses non-admins and requires `confirm: "PURGE ALL MOOD DATA"`. It walks `private_messages`, `private_rooms`, `image_reactions`, `public_images`, `generation_usage`, `provider_usage`, deletes each record, and deletes referenced files (public images from the app scope; voice/image chat media from each sender's private scope). It returns per-collection counts and errors.
2. Run it as the owner:
   ```bash
   echo '{"confirm":"PURGE ALL MOOD DATA"}' > purge.json
   npx deepspace agent invoke mood admin_purge_mood_data --input-file purge.json --json
   ```
3. Verify every collection reports `"count":0` (the `records_query` loop above) and check storage with `npx deepspace app files list`.
4. **Remove the tool immediately** and confirm it is gone from the live app:
   ```bash
   git revert --no-edit HEAD
   npx deepspace deploy
   npx deepspace agent tools mood --json | grep -c admin_purge   # expect 0
   ```

Never leave the purge tool deployed: it is exposed through the agent HTTP/MCP surface for as long as it exists.

To remove a single image rather than everything, use the in-app admin **Take down** (it hides the record and deletes the file) instead of a reset.

---

## 11. Known limitations and future work

- **Counter races:** usage counters, unread maps and like counts are read-modify-write in actions; concurrent writes can be off by one. Acceptable at current scale; could move to per-event rows or DO-side increments.
- **Feed paging** raises the query limit instead of paging by cursor; very long histories load more rows than needed.
- **Image size:** real provider images are stored as returned (PNG ~1–1.5 MB); re-encoding to WebP would multiply storage headroom.
- **Safety:** no prompt filter, no user blocking/reporting for DMs; consider both before broad launch.
- **Voice notes** are not transcribed; private chat paintings don't appear on the account page.
- **Safari < 16.4** omits `Sec-Fetch-Site`, so cookie-based private media reads return 401 there.
- **Local test runs write to real storage.** Public mock images were removed on 2026-11-26 (§10.1); ~82 KiB of mock chat media remains in the test accounts' private folders, unreferenced and unreachable from the CLI.
