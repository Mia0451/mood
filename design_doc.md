# Technical Design Doc: `mood` Web Application

## 1. Overview & Goals
`mood` is a real-time social web application where users convert spoken voice prompts into AI-generated images and share them in a public chat room, with the option to transition into 1-on-1 private rooms. 
* **Stack:** Built on **DeepSpace SDK** (Vite + React frontend, Tailwind v4, Cloudflare Hono Worker, SQLite-backed `RecordRoom` Durable Objects, and R2 object storage).
* **Core Constraint:** Zero-to-minimal LLM API spend via a multi-provider free-tier rotation router (stubbed for Google, Meta, OpenAI, and DeepSpace built-in proxy helpers).

---

## 2. User Roles & Authentication
Authentication leverages DeepSpace's built-in Google OAuth integration (`billing: 'user'` in `src/integrations.ts` for identity scopes `openid`, `userinfo.email`, `userinfo.profile`).

| Capability | Anonymous User | Signed-In User (Google OAuth) |
| :--- | :--- | :--- |
| **App Bar Actions** | `Log In` button (top-right) | `Account` & `Log Out` buttons (top-right) |
| **Public Room Feed** | View all generated images (scroll history) | View all generated images (scroll history) |
| **Author Identity** | Masked avatar/name (e.g., blurred placeholder) | Real Google profile picture & display name |
| **Image Reactions** | `Like` / `Dislike` any image | `Like` / `Dislike` *other* users' images only |
| **Voice-to-Image** | Hidden | Click-to-speak composer at bottom of public room |
| **1:1 Private Chat** | Hidden | Click/hover another user's image $\rightarrow$ `Chat` |
| **Account Page** | Restricted (redirects to login) | Full access to personal image feed & chat history|

---

## 3. System Architecture & DeepSpace Primitives

### A. Data Model (`RecordRoom` Schemas)
Because DeepSpace's bundled `CHANNELS_SCHEMA` is strictly public, `mood` defines custom collections in `src/schemas.ts` to enforce ownership, immutability, and private room isolation:

1. **`users` (`read: true`, `create/update: 'own'`)**
   * `userId` (JWT subject), `displayName`, `avatarUrl`
2. **`public_images` (`read: true`, `create: 'member'`, `update: false`, `delete: false`)**
   * `imageId`, `ownerId`, `r2Key`, `promptTranscript`, `providerUsed`, `createdAt`
   * *Immutability:* Setting `delete: false` enforces the rule that users cannot delete previously generated images at the database layer.
   * *Anonymous Masking:* A custom Worker read middleware or view projection strips `ownerId`, `displayName`, and `avatarUrl` when no valid JWT is attached.
3. **`image_reactions` (`read: true`, `create: true`, `update: 'own'`, `delete: 'own'`)**
   * `imageId`, `actorId` (JWT subject for signed-in users; anonymous browser fingerprint/session ID for guests), `type` (`'like' | 'dislike'`)
   * *Self-Vote Prevention:* Worker validation hook rejects writes where `actorId === image.ownerId`.
4. **`private_rooms` (`read: 'shared'`, `collaboratorsField: 'participants'`)**
   * `roomId` (deterministic composite key: `sort([userA, userB]).join('_')` to ensure 1:1 room reuse), `participants` (`[userA, userB]`), `lastMessageAt`
5. **`private_messages` (`read: 'shared'`, `collaboratorsField: 'participants'`)**
   * `roomId`, `participants`, `senderId`, `type` (`'text' | 'voice' | 'image'`), `content` (text string or R2 key), `createdAt`

### B. Media Storage (`useR2Files` & `appFiles`)
* **Public & AI-Generated Images:** Stored in R2 via Worker `appFiles(env, { scope: 'app' })` so images render directly via `<img src={getUrl(key)} />` for both signed-in and anonymous visitors.
* **Private Voice Notes & Chat Media:** Stored with `{ scope: 'self' }` or participant-scoped keys so private audio/images are auth-gated.

---

## 4. Key User Flows & UI Layout

### 1. Public Chat Room (`/`)
* **Top App Bar:** Brand logo (`mood`) on the left; `Log In` (or `Account` + `Log Out`) on the right.
* **Stream Feed:** Chronological stream of generated image cards.
  * *Anonymous View:* Displays image, like/dislike counters, and a generic masked user icon.
  * *Signed-In View:* Hovering/clicking another user's image opens a context menu (`Like`, `Dislike`, `Chat`). Own images hide this menu.
* **Bottom Composer (Signed-In Only):** Hold/click-to-speak button captures audio via browser `MediaRecorder` / Web Speech API and submits to `POST /api/generate-mood`.

### 2. 1-on-1 Private Chat Room (`/chat/:roomId`)
* **Creation/Reuse:** Clicking `Chat` on User B's public image invokes a server action that finds or creates `private_rooms` for `[userA, userB]` and inserts an initial `private_messages` record with `senderId: userB` containing the clicked image.
* **Capabilities:** Both participants can send text messages, raw voice recordings, or trigger the voice-to-image pipeline inside the private thread.

### 3. Account Page (`/account`)
Two-tab dashboard protected by authenticated route guard:
* **Tab 1 — Generation Feed:** Split-pane layout with a sticky date rail (`DD/MM/YYYY`, newest first) on the left and a descending grid of the user's generated images on the right. Clicking an image opens a lightbox modal with zoom-in/zoom-out controls. No delete actions are exposed.
* **Tab 2 — Chat History:** List of `private_rooms` sorted by `lastMessageAt` descending, displaying the peer's Google profile avatar and name. Clicking a row navigates to `/chat/:roomId`.

---

## 5. Zero-Cost Voice-to-Image Router (`POST /api/generate-mood`)
To avoid billing charges during development and low-volume usage, a Worker server action implements a round-robin / quota-aware **Provider Router** tracked in a `provider_usage` SQLite collection (reset monthly via DeepSpace `cron`):

1. **Step 1 — Speech-to-Text (STT):** Uses browser Web Speech API on the client (zero server cost) with a fallback stub to Whisper/Deepgram free tiers if raw audio blobs are uploaded.
2. **Step 2 — Image Generation Stubs & Free-Tier Rotation:**
   The router iterates through configured providers in `src/ai/image-router.ts` until one succeeds without exceeding its monthly free-tier threshold:
   * `provider_1`: **DeepSpace Built-in AI Proxy** (if covered under platform allowance)
   * `provider_2`: **Google Imagen / Gemini Flash Image** (`GOOGLE_API_KEY` placeholder)
   * `provider_3`: **OpenAI DALL-E / GPT-Image** (`OPENAI_API_KEY` placeholder)
   * `provider_4`: **Meta / HuggingFace / Together Free Tier** (`META_API_KEY` placeholder)
   * `fallback_stub`: Returns a deterministic placeholder SVG/PNG stored in R2 when all keys are unset or quotas are exhausted, allowing full end-to-end UI testing without external spend.

```typescript
// src/ai/image-router.ts (Stub Interface)
export interface ImageProviderStub {
  name: 'deepspace' | 'google' | 'openai' | 'meta' | 'mock';
  monthlyFreeLimit: number;
  apiKeyEnvVar?: string;
  generate(prompt: string, env: Env): Promise<ArrayBuffer>;
}
```