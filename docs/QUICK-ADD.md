# Quick add — the chat box on the board

Type a sentence the way you would say it; Yorki turns it into cards. It is a set
of plain rules (no AI, no internet lookups): instant, predictable, and your text
stays in the browser until you press **Enter** / **Create**.

You always get a **live preview** first. Fix the title, people, date, time or
priority there, or remove a card, before anything is created. Cards land in
**Inbox** exactly like cards from the New task form (same emails, notifications,
and calendar behaviour).

## What it understands (English)

| You type | It does |
|---|---|
| `I want @Mia to work on the roof` | Assigns Mia · title **Work on the roof** |
| `Ana should call the supplier` · `Have Ana…` · `Ask Ana to…` · `Ana: …` · `Assign this to Ana` | Assigns Ana |
| `Remind me to call John` · `I'll order tiles` | Assigns **you** |
| `…by Friday` · `until Dec 5` · `tomorrow` · `in 3 days` · `next week` · `end of month` · `12/5` · `the 15th` | Due date (US month/day order) |
| `…Friday at 3pm` · `at 15:00` · `by noon` | Due time |
| `urgent` · `ASAP` · `right away` | Priority **Urgent** |
| `high priority` · `this is important` | **High** |
| `no rush` · `whenever` · `not urgent` | **Low** |
| `#plumbing` | Label |
| *one per line*, bullets, sentences, or `Pay the rent, call John and email Ana` | Several cards |
| `I want @Mia to work on this. She has until Dec 5.` | **One** card — a follow-up starting with *she / he / they / it / this / by / until / due* adds details to the previous card |

The original wording is kept in the card's description whenever details were
pulled out of it.

## Good to know

- **Names:** `@Mia`, `Mia`, or `@Mia Porter`. A bare name (no `@`) only counts as the
  assignee in phrases like "Mia should…", so `Email Mia about the invoice` is *not*
  assigned to Mia. If two people share a first name, or you `@` someone who isn't a
  user, it warns you instead of guessing.
- **Dates:** `Friday` means the *next* Friday; `this Friday` includes today; `next Friday`
  is the Friday of next week. A month/day that has already passed means next year.
  Always check the date shown in the preview.
- **Splitting:** "pay the bill and call John" becomes two cards. Untick
  *Split … into separate cards* if you want one.
- Up to 20 cards per message. Anyone signed in can use it; people you can assign are
  the same as on the New task form.

## Limits

- **English only** for now (dates, weekdays, "urgent", "should", …).
- It follows rules, not meaning: unusual wording may be missed, which is why you
  see the preview before creating.

Code: `src/lib/quick-add/parse.ts` (rules, with tests in `tests/quick-add.test.cjs`) ·
`src/components/board/QuickAdd.tsx` (box + preview) ·
`tests/e2e/quick-add.js` (browser test).
