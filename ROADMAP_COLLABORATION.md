# Operation Warroom — Collaboration & Intelligence Feed
### A Campaign Plan for Real-Time Sector Communication

> **Vision:** Transform the Query Generator from a solo tool into a living intelligence hub — where every generated query can spark a conversation, every mistake becomes a lesson for the entire Sector, and Colonels and Captains build shared SQL knowledge together in real time.

---

## The Big Picture

Right now the loop is: *generate → review → correct → approve*. Silent. Individual. Invisible.

The goal of this campaign is to make that loop **visible, social, and collaborative**. After this ships, a Captain generates a query, it errors out in production, they post it to the Sector feed with a note. A Colonel replies with the fixed version. The correction is automatically filed. Everyone in the Sector sees it. The next time someone asks a similar question, the model already knows the fix — because it was embedded into knowledge the moment the Colonel approved it.

Think **GitHub Discussions + Twitter Explore + Slack**, all inside the Sector. Role-gated. Sector-scoped. Tied directly to SQL history.

---

## Phase A — The Post System (Foundation)
*What Twitter calls a "tweet." We call it a **Signal**.*

### A.1 Backend: Signal Model

New table `sector_signals`:

```
id              UUID PK
sector_id       UUID FK → sectors
author_id       UUID FK → users
kind            ENUM: 'query_share' | 'error_report' | 'correction_proposal' | 'announcement' | 'question'
body            TEXT (max 2000 chars)
history_id      UUID FK → query_history (nullable — links to a specific generation)
sql_snapshot    TEXT (nullable — the SQL at time of posting, immutable)
question_snapshot TEXT (nullable — the NL question at time of posting)
pinned          BOOLEAN DEFAULT FALSE
pinned_by       UUID FK → users (nullable)
created_at      TIMESTAMPTZ
edited_at       TIMESTAMPTZ (nullable)
```

**Rules:**
- Soldiers can post `query_share`, `error_report`, `question`
- Captains can post all of the above + `correction_proposal`
- Colonels can post all + `announcement`, and can pin any signal
- Generals can post all + moderate (delete, archive) any signal

### A.2 Backend: Signal Routes

```
POST   /v1/sectors/{sid}/signals                    — create a signal
GET    /v1/sectors/{sid}/signals                    — paginated feed (all kinds)
GET    /v1/sectors/{sid}/signals?kind=error_report  — filtered feed
GET    /v1/sectors/{sid}/signals/{signal_id}        — single signal + thread
PATCH  /v1/sectors/{sid}/signals/{signal_id}        — edit body (author only, within 15 min)
DELETE /v1/sectors/{sid}/signals/{signal_id}        — author or Colonel+
POST   /v1/sectors/{sid}/signals/{signal_id}/pin    — Colonel+
DELETE /v1/sectors/{sid}/signals/{signal_id}/pin    — Colonel+
```

### A.3 "Quote from History" — the Key UX Flow

In Query History, every row gets a **"Share to Feed"** button.

Clicking it opens a compose modal pre-filled with:
- The original question (read-only snapshot)
- The generated SQL (read-only snapshot)
- A text area: *"What happened? What do you want to discuss?"*
- Kind selector: Error Report / Question / Share

This creates a `query_share` or `error_report` Signal with `history_id` set — immutably linking the Signal to the exact generation that triggered it.

### A.4 Frontend: The Feed Page

New nav item **"Sector Feed"** — visible to all roles (Soldiers included).

Layout: Twitter Explore style.

```
┌─────────────────────────────────────────────────────────────────┐
│  SECTOR FEED          [Alpha Brigade]         [+ New Signal]    │
├──────────┬──────────────────────────────────────────────────────┤
│ 🔵 All   │  📌 PINNED BY Colonel Adams                          │
│ 🔴 Errors│  ┌─────────────────────────────────────────────────┐│
│ 🟡 Q's   │  │ ⚡ Query Share · Cpt. Zhang · 2h ago            ││
│ 📢 Ann.  │  │ "Monthly revenue query — works great for Q1,    ││
│ ✅ Fixed  │  │  but breaks on NULL dates. Sharing for review." ││
│          │  │                                                  ││
│          │  │  Q: "What was total revenue last month?"        ││
│          │  │  ▼ Show SQL                                     ││
│          │  │                                                  ││
│          │  │  💬 3 replies  · ✅ Marked fixed · 👍 5 likes   ││
│          │  └─────────────────────────────────────────────────┘│
│          │                                                      │
│          │  🔴 Error Report · Sgt. Park · 5h ago               │
│          │  "This query returned wrong totals for..."           │
│          │  ...                                                 │
└──────────┴──────────────────────────────────────────────────────┘
```

**Kind pills:** color-coded badges — red for Error, amber for Question, blue for Share, green for Announcement.

---

## Phase B — Threads & Reactions
*Signals alone are broadcasts. Threads turn them into conversations.*

### B.1 Backend: Replies

New table `signal_replies`:

```
id          UUID PK
signal_id   UUID FK → sector_signals
author_id   UUID FK → users
body        TEXT (max 1000 chars)
sql_patch   TEXT (nullable — a Colonel's corrected SQL snippet)
created_at  TIMESTAMPTZ
edited_at   TIMESTAMPTZ (nullable)
```

Routes:
```
POST   /v1/sectors/{sid}/signals/{signal_id}/replies
GET    /v1/sectors/{sid}/signals/{signal_id}/replies
PATCH  /v1/sectors/{sid}/signals/{signal_id}/replies/{reply_id}
DELETE /v1/sectors/{sid}/signals/{signal_id}/replies/{reply_id}
```

**The killer feature:** when a Colonel writes a reply and includes a `sql_patch`, a **"File as Correction"** button appears. One click: creates a pending Correction in the corrections queue pre-filled from the Signal's `history_id`, `question_snapshot`, and the Colonel's `sql_patch`. The correction is linked back to the Signal so reviewers have full context.

### B.2 Backend: Reactions

```
POST   /v1/sectors/{sid}/signals/{signal_id}/react   body: {"emoji": "👍"}
DELETE /v1/sectors/{sid}/signals/{signal_id}/react   (toggle off)
```

Limited emoji set: 👍 👎 🔥 ✅ ❓ — no free-form to keep it professional.

### B.3 Frontend: Signal Detail Panel

Click any Signal → right panel slides in (or bottom sheet on mobile):

```
┌──────────────────────────────────────────────────────────┐
│  🔴 Error Report                              [✕ Close]  │
│  Cpt. Zhang · Alpha Brigade · 3h ago                     │
├──────────────────────────────────────────────────────────┤
│  "Monthly revenue query fails on NULL dates"             │
│                                                          │
│  Original Question:                                      │
│  "What was total revenue last month?"                    │
│                                                          │
│  SQL at time of report:                                  │
│  ┌────────────────────────────────────────────────────┐  │
│  │ SELECT SUM(amount) FROM orders                     │  │
│  │ WHERE date >= '2026-04-01'                         │  │
│  │   AND date < '2026-05-01'                          │  │
│  └────────────────────────────────────────────────────┘  │
│  [Copy SQL]  [View full history entry]                   │
├──────────────────────────────────────────────────────────┤
│  👍 4   🔥 1   ✅ 0         [React]                      │
├──────────────────────────────────────────────────────────┤
│  REPLIES (2)                                             │
│                                                          │
│  Col. Adams · 2h ago                                     │
│  "The issue is NULLs in order_date. Fixed SQL below:"    │
│  ┌────────────────────────────────────────────────────┐  │
│  │ SELECT COALESCE(SUM(amount), 0) FROM orders        │  │
│  │ WHERE order_date >= '2026-04-01'                   │  │
│  │   AND order_date < '2026-05-01'                    │  │
│  └────────────────────────────────────────────────────┘  │
│  [File as Correction ↗]                                  │
│                                                          │
│  Sgt. Park · 1h ago                                      │
│  "Confirmed, this fix works. Tested on Q4 data too."     │
│                                                          │
│  ┌─ Write a reply... ─────────────────────────────────┐  │
│  │                                                    │  │
│  └────────────────────────────────────────────────────┘  │
│  [Reply]                                                 │
└──────────────────────────────────────────────────────────┘
```

---

## Phase C — Notification Center
*The bell icon. Every Sector member's personal inbox.*

### C.1 Backend: Notification Model

New table `notifications`:

```
id              UUID PK
user_id         UUID FK → users
sector_id       UUID FK → sectors
kind            ENUM: see below
actor_id        UUID FK → users (who triggered it)
signal_id       UUID FK → sector_signals (nullable)
correction_id   UUID FK → corrections (nullable)
body            TEXT (short — rendered in the bell dropdown)
read            BOOLEAN DEFAULT FALSE
created_at      TIMESTAMPTZ
```

**Notification kinds:**

| kind | Triggered when | Who gets it |
|---|---|---|
| `reply_on_your_signal` | someone replies to your Signal | signal author |
| `reaction_on_your_signal` | someone reacts to your Signal | signal author |
| `correction_filed` | a correction is filed from a Signal | all Colonels in sector |
| `correction_pending` | a new pending correction arrives | all Colonels in sector |
| `correction_approved` | your correction was approved | correction creator |
| `correction_rejected` | your correction was rejected | correction creator |
| `signal_pinned` | a Colonel pins a Signal | all sector members |
| `announcement` | a Colonel posts an `announcement` Signal | all sector members |
| `mentioned` | someone @-mentions you in a Signal or reply | mentioned user |

**Fan-out strategy:** write notifications synchronously inside the route handler for low-volume events (replies, reactions). Use a background task (FastAPI `BackgroundTasks`) for fan-out events that touch the whole sector (announcements, pinned).

Routes:
```
GET    /v1/notifications?read=false&limit=20    — personal inbox
POST   /v1/notifications/read-all              — mark all as read
PATCH  /v1/notifications/{nid}/read            — mark one as read
```

### C.2 Frontend: Bell Icon in Header

Replace the static header right section:

```
┌─────────────────────────────────────────────────────────────────┐
│  🔔 3   |  ⭐ col.adams   |  [Alpha Brigade ▾]   |  [→ logout]  │
└─────────────────────────────────────────────────────────────────┘
```

The bell (`🔔`) shows a red count badge when there are unread notifications.

Clicking opens a dropdown panel (max-h scrollable):

```
┌─ NOTIFICATIONS ─────────────────────────────────────[Mark all read]─┐
│                                                                      │
│  ● Col. Adams replied to your signal "NULL date bug"         2h ago  │
│  ● Your correction was approved by Col. Adams                5h ago  │
│  ● 📢 ANNOUNCEMENT: New catalog deployed — "finance_v3"      1d ago  │
│  ● Sgt. Park reacted 👍 to your signal                       2d ago  │
│                                                                      │
│  [See all notifications]                                            │
└──────────────────────────────────────────────────────────────────────┘
```

Clicking a notification navigates to the relevant Signal/Correction and marks the notification read.

### C.3 Real-Time: WebSocket or SSE

**Option A — SSE (simpler, recommended first):**
```
GET /v1/notifications/stream   (SSE, auth via token in query param)
```

Backend pushes a `notification` event whenever a new notification row is inserted for this user. Frontend increments the badge count without polling.

**Option B — WebSocket (richer, phase 2):**
Enables typing indicators ("Col. Adams is replying…") and live feed updates.

Start with SSE, upgrade to WebSocket in Phase D.

---

## Phase D — @Mentions & Smart Linking
*The "social graph" layer that ties people and queries together.*

### D.1 @Mentions

In Signal body and replies, `@username` is parsed at write time:
- Backend resolves mention targets to `user_id`s
- Inserts a `mentioned` notification for each
- Frontend auto-completes on `@` keypress (GET sector members list)

Mention rendering: highlighted `@username` chips that navigate to a user's signal history.

### D.2 Query Card Embeds

When a Signal has a `history_id`, the frontend renders an embedded **Query Card** inside the Signal — showing the original question, a truncated SQL snippet, and a "View full" link into Query History. No copy-paste needed; the Signal carries its own snapshot.

### D.3 Signal Search

```
GET /v1/sectors/{sid}/signals?q=revenue+NULL
```

Full-text search across Signal body + question_snapshot + sql_snapshot. Backed by PostgreSQL `tsvector` with a GIN index. No external search dependency.

---

## Phase E — Collaborative SQL Editor (The Flagship Feature)
*Two people. One SQL. Real-time.*

### E.1 Signal → Live Edit Session

A Signal of kind `correction_proposal` can be "opened for collaboration."

When a Colonel clicks **"Edit Together"** on a `correction_proposal`:
1. A **SharedEdit session** is created (UUID, 30-minute TTL)
2. The Captain who filed the Signal gets a notification: *"Col. Adams wants to edit this query with you"*
3. Both join a shared editor — a `<textarea>` backed by an operational transform or last-write-wins crdt (start with last-write-wins for simplicity)

The session produces a single agreed SQL. On close, one click files it as an approved Correction (Colonel is the approver, Captain is the creator — satisfies the `approved_by != created_by` integrity rule automatically).

**Backend:** WebSocket room per session. Redis pub/sub or PostgreSQL `LISTEN/NOTIFY` as the transport.

### E.2 Cursor Presence

Each participant's cursor position is broadcast. The other user sees a colored cursor (blue for Colonel, green for Captain) moving in the editor.

---

## Phase F — Intelligence Feed Analytics
*Make the feed useful for Generals who run multiple Sectors.*

### F.1 Signal Digest

Weekly digest email (or in-app summary) per sector:
- Top 5 signals by reaction count
- Open error reports (no approved correction yet)
- Most active contributors
- Correction approval rate this week

### F.2 "Error Map"

A General-only view: a heatmap across all Sectors showing which catalogs produce the most error reports. Drilldown to the specific signals.

### F.3 Trending Queries

Surface queries that multiple Soldiers asked independently (similar embeddings) — these are candidates for canned answers or catalog improvements. Show to Colonel as *"5 people asked variations of this — consider adding it to knowledge."*

---

## Phase G — Command Channel (Sector DMs)
*The private Slack-like layer for sensitive coordination.*

### G.1 Direct Channels

Point-to-point messaging between any two members in the same Sector. Separate from the public Signal feed.

```
POST   /v1/sectors/{sid}/channels               body: { "peer_id": UUID }
GET    /v1/sectors/{sid}/channels               — list my channels
GET    /v1/sectors/{sid}/channels/{cid}/messages
POST   /v1/sectors/{sid}/channels/{cid}/messages
```

### G.2 Channel Scoping

- Colonel can open a channel to any Captain or Soldier in their Sector
- Captain can open a channel to any Colonel or peer Captain
- Soldier can message their Captain
- General can message anyone anywhere

All messages are **Sector-scoped** — a General's DM in Sector A is not visible in Sector B. This matches the multi-tenant design.

### G.3 Message Types

| kind | Content |
|---|---|
| `text` | plain message |
| `sql_snippet` | SQL with syntax highlight + copy button |
| `signal_share` | embed a Signal card inline |
| `correction_link` | link to a pending correction with approve/reject inline |

### G.4 Frontend: Unified Inbox

The notification bell dropdown gets a **"Messages"** tab alongside **"Notifications"**. New messages increment a separate badge on the bell.

---

## Phase H — Knowledge Lifecycle Integration
*Close the loop between the feed and the RAG embeddings.*

### H.1 Signal → Correction → Embedding pipeline

Current: Correction → approve → embed.

After Phase H: Signal → reply with sql_patch → "File as Correction" → approve → embed.

The Signal's `id` is stored on the Correction so an auditor can trace: *"Why was this correction filed? — because of Signal #abc."*

### H.2 "Invalidation Signals"

A Colonel can post an `invalidation` Signal that flags an existing knowledge row as outdated. This does not delete the embedding immediately but:
1. Marks the knowledge row `status='flagged'`
2. Notifies the General
3. On next query generation, flagged rows get a score penalty (multiply by 0.5)
4. General approves the invalidation → row deleted + embedding dropped

### H.3 Knowledge Attribution

In the generated query result panel, the "Context Used" section currently shows chunk IDs. Upgrade it to show:
- Which knowledge row was used
- Whether it came from a Correction (and which Signal originated it)
- The date it was embedded

This makes the AI's reasoning transparent: *"This query was shaped by a correction that Col. Adams approved on May 15, filed from Signal #abc: 'NULL date bug'."*

---

## Sequencing

```
Phase A — Signal post system + Feed page                [4–6 days]
   │
   ├──> Phase B — Threads + Reactions + "File as Correction" button
   │                                                    [3–4 days]
   ├──> Phase C — Notification Center + SSE stream      [4–5 days]
   │       │
   │       └──> Phase D — @Mentions + Query Card embeds [2–3 days]
   │
   ├──> Phase E — Collaborative SQL Editor              [5–7 days]
   ├──> Phase F — Intelligence Feed Analytics           [3–4 days]
   ├──> Phase G — Command Channel (DMs)                 [5–6 days]
   └──> Phase H — Knowledge Lifecycle Integration       [3–4 days]
```

**Minimum Viable Product (ship after Phase B):**
Signals → Threads → "File as Correction" button. This alone transforms the Corrections page from a one-way queue into a conversation. Every other phase is a multiplier on top.

---

## Design Principles

1. **Sector-scoped, always.** No Signal, notification, or message crosses a Sector boundary without a General explicitly acting on it.

2. **Role integrity is sacred.** The `approved_by != created_by` rule from corrections extends to the whole system. A Colonel can propose a fix; they cannot be both the proposer and approver of their own fix (Phase E's collaborative editor handles this by design — Captain proposes, Colonel approves).

3. **The feed is a knowledge input, not noise.** Every approved Signal-derived correction feeds back into the RAG embeddings. The feed makes the model smarter over time.

4. **Nothing new until Phase A ships.** Each phase depends on the Signal model from Phase A. Don't start Phase C without Phase A's backend routes in production.

5. **Mobile-first layout.** Colonels in the field need to approve a correction from a phone. Every feed, thread, and notification view must work in the 375px mobile breakpoint.

---

## Out of Scope

- Cross-Sector public feeds (intentionally siloed)
- GIF / image uploads in signals or messages
- Voice/video in Command Channels
- Signal analytics visible to Soldiers (analytics are Colonel+ only)
- External integrations (Slack mirroring, email threading)

These can get their own campaign plan if the need arises.
