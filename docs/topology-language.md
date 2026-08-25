# The topology language — places, flows, changes

Binding for every topology surface (live, replay, timelapse). This document defines the three nouns of the map, the exact text each element may carry, and the playback grammar. When a rendering question isn't answered here, answer it by the three-questions test in §6.

## 1. The three nouns

Everything on the canvas is exactly one of these. Nothing is ever two of them.

**A place** is somewhere on the site where state lives and where changes land: the site itself, a page or post, a setting, a plugin's domain, a menu, a term, a user, an ability. Places are the *nodes* — the only things with a position on the map.

- Litmus test: *could you go there tomorrow, when nothing is happening, and it would still exist?* Page 464 passes. The site tagline passes. "A QA journey," "a WP-CLI run," "a session," "agent work" all fail — they are time, not territory.
- Places persist and remember. A trashed page stays on the map with state "Trash"; deletion is a change that happened at the place, not the removal of the place.
- The root node is a place too: **the site itself** — its address and name. It is never "Agent work on this site" or any other description of activity. Activity is not a place.

**A flow** is how change arrives at a place: a channel (WP-CLI, REST, MCP, wp-admin, cron) carrying an actor's work toward a place. Flows are the *edges* — drawn, never carded.

- Direction is always actor → place: the flow points at where the change lands.
- Connection lifecycle (open, ready, heartbeat, close, timeout, reconnect) is the flow's *liveness* — it changes how the edge looks and moves, and creates nothing.
- Litmus test: *if you froze time, would it be a thing or a happening?* A happening is a flow or a change, never a node.

**A change** is one event that happened *at* a place, *via* a flow, *at* a time: "Tagline updated." "Page trashed." "SEO title set." Changes are *moments* — they exist as text and light, never as spatial elements.

- A change has two halves that must stay distinguishable: the **claim** (what the agent declared it would do / asked for) and the **confirmation** (what WordPress independently reported). A claim without a confirmation is "in flight" or, eventually, "unconfirmed" — never silently promoted.
- Changes accumulate as a place's history. The map never grows because changes happened; it grows only when a change touches a *new place*.

## 2. The card text contract

Every place card carries at most five text elements, in this order, with these jobs. Nothing else appears on a card.

| # | Element | Job | Example (tagline) | Example (page) |
|---|---|---|---|---|
| 1 | **Kicker** — place type · address | *Where is this?* | `Setting · blogdescription` | `Page · 464` |
| 2 | **Name** — what this place is called | *What do I call it?* | Site tagline | "Aphelion QA journey 2026-08-25" |
| 3 | **State line** — current state at the playhead | *What is it right now?* | Text value · restored | Trash · 4 blocks |
| 4 | **Last change** — most recent change, verb-first, with channel | *What just happened here?* | Updated · via WP-CLI · 10:56:32 | Trashed · via WP-CLI · 10:56:41 |
| 5 | **History affordance** — the memory door | *What else happened here?* | 2 changes · open history | 12 changes · open history |

Hard rules:

- **Nouns on cards, verbs in changes, channels on flows.** If a card's name or kicker contains a verb phrase, the element is misclassified — it is a change pretending to be a place.
- **The name is the place's name, never a description of activity.** When the name is user-authored content (a page title), the kicker is what disambiguates it — `Page · 464` above "Aphelion QA journey 2026-08-25" tells the reader that string is a *title*, not an abstraction. Kicker and name must always appear together for content places.
- **One state line, one last-change line.** The card shows the present and the most recent past. Everything older lives behind the history affordance. Cards never accumulate rows as events occur — that is the timeline-in-a-card failure this document exists to prevent.
- **Claims never appear as card rows.** "Intent · Temporarily edit site tagline" is a claim belonging to a change record. On the card it may surface only inside the last-change line's status ("Updating… · claimed via WP-CLI" while in flight). In history, every change shows claim beside confirmation.
- **Counts summarize memory, not process**: "2 changes" or "3 visits," never request IDs, seq numbers, or journey names. Engineering identifiers live one level down, in the inspector.

## 3. The flow contract

- An edge's at-rest label is the **channel, alone**: `WP-CLI`, `REST`, `MCP`, `wp-admin`. Transport plumbing (`docker-exec → process`, `stdio`, `ssh`) is inspector detail — it never rides the canvas.
- A live flow may add the actor when known: `WP-CLI · agent`. Actor identity comes from the trail, never inferred.
- Edge states, in escalating order: **idle** (hairline, no motion) → **claimed / in flight** (declared, unconfirmed — motion toward the place) → **live** (presence open — sustained energy) → **settled** (recent change confirmed — cooling glow) → back to idle. "Live" is reserved for actual presence; a declaration alone never earns it.
- Motion duration uses recorded timing (declared→confirmed latency, connection duration) when measurable. Fallback pacing is allowed; fabricated precision is not.

## 4. The change contract

Where change text lives, by surface:

- **On the card**: last-change line only (§2, row 4).
- **In history** (expanded card): one row per change — time, verb phrase, claim⇄confirmation status, channel. Reverse-chronological. Scrollable. This is where "Temporarily edit site tagline" and "Restore site tagline" belong: two change records on one place.
- **In the ledger** (side rail): the same changes in strict trail order across all places — the audit view. The ledger and the map are two projections of one record; they never disagree.
- Verb conventions: past tense once confirmed ("Updated", "Trashed"), present progressive while in flight ("Updating…"), and "Claimed" as the prefix for any unconfirmed declaration. Never a noun phrase where a verb phrase belongs.

## 5. The playback grammar

At any playhead moment the viewer should be able to say what is happening in one sentence: *"[Actor] via [channel] is changing [place]."* The animation sequence for one change, in order:

1. The claim appears: the flow enters "in flight," motion runs actor → place.
2. The confirmation lands: the place pulses once, its state line and last-change line update, its visit count increments.
3. The flow settles; the place's glow cools over time. The map itself has not moved.

One moment, one focus: at most one flow is in the "in flight or landing" state per playhead instant (the trail is ordered; simultaneity is resolved by seq). Everything else on the canvas is memory — dimmer, still, and stable. New places are born only at step 2 of their first change, revealed in place; existing places never move because time advanced.

## 6. The three-questions test

Every visual layer answers exactly one question, and each question is answered by exactly one layer:

| Question | Answered by | Never answered by |
|---|---|---|
| **Where can things happen?** | The map: places and their positions | Cards appearing/disappearing over time |
| **What is happening now?** | Light and motion: edge state, place pulse | Text accumulating on cards |
| **What has changed?** | State lines, history, the ledger | Extra nodes, extra edges |

If a proposed element answers two questions at once, split it. If it answers none, delete it.

## 7. Applied: correcting the 10:56 board

Current rendering → contract rendering:

- Root card "**Agent work on this site** / 2 objects · 1 channel" → kicker `Site · localhost:8081`, name **Accelerate Demo** (the site's actual name, from the trail's session metadata), state line `2 places touched · WP-CLI active`. The agent is an actor on flows, not the name of the root.
- Page card "**Aphelion QA journey 2026-08-25** / Status · Trash / Observed · Post trashed / +12 more" → kicker `Page · 464`, name unchanged (it is the real title), state line `Trash · 4 blocks`, last change `Trashed · via WP-CLI · 10:56:41`, then `12 changes · open history`. "Status" and "Observed" rows disappear — they were the state line and last-change line wearing property-row costumes.
- Tagline card "**Site tagline** / Intent · Temporarily edit… / Intent · Restore… / Setting · Updated" → kicker `Setting · blogdescription`, name **Site tagline**, state line `Restored to prior value`, last change `Updated · via WP-CLI · 10:56:32`, then `2 changes · open history`. The two intents move into history as the claims of those two changes.
- Edge label "`wp-cli · docker-exec → process`" → `WP-CLI` (transport to the inspector).
