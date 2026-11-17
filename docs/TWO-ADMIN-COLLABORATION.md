# Two-admin collaboration test — 2026-11-16

Scope: two equal-power admin browser sessions, Alex and Blair, using one shared temporary SQLite database and one local production server. The live Droplet and production data were not touched.

## What happened

1. Alex and Blair opened the same card, **Coordinate lobby countertop install**, in Inbox. Both saw the same initial title, assignee, and checklist.
2. Alex dragged it to Pending and added a regular task comment:

   > Moved to Pending because the lobby measurements still need client confirmation. — Alex

3. Blair's already-open board still showed Inbox. Yorki did not push the move or comment into that browser. When Blair opened/refetched the task, Pending and Alex's comment appeared.
4. Blair moved it to In Progress and added:

   > Moved to In Progress because I assigned the installer and work can start. — Blair

5. The task discussion showed both explanations in chronological order with their authors. The database activity trail also recorded Alex moving Inbox → Pending and Blair moving Pending → In Progress.
6. Both admins then edited the title from stale copies and saved almost simultaneously. Each browser showed its own title as successfully saved. The database kept only the last write. Across two runs, either Alex or Blair could win. There was no conflict message and no merge.
7. From two stale copies, Alex selected **Mark Complete** while Blair selected **Archive**. Both actions reported success. The final database state was Archived, with a completion timestamp. Activity recorded `task_completed` followed by `task_archived`; neither person was warned that another lifecycle action occurred.

## What Yorki communicates today

| Capability | Result |
| --- | --- |
| Task comments with author and time | Works and is the clearest place to explain a decision. |
| Admin-only internal notes | Work for admin-to-admin communication; staff cannot see them. Use a regular comment when the whole assigned team needs the reason. |
| Move audit | Database records actor, source, destination, and status change. |
| Activity page | Shows time, actor, action, and task, but does not display source/destination or a human reason. |
| Live updates | Missing. An open board can remain stale until navigation or refresh. |
| Simultaneous edit protection | Missing. Last write wins silently. |
| Presence/edit indicator | Missing. A user cannot see that someone else has the card open or is editing. |
| Mentions/notifications | Missing. Typing a name in a comment does not notify that person. |

## Human operating rule for the current release

Until collaboration controls are built, use a regular task comment before or immediately after a meaningful move:

> **MOVE:** Inbox → Pending<br>
> **Why:** Waiting for client confirmation of the lobby measurements.<br>
> **Next:** Alex will call the client by 2 PM.<br>
> **Owner:** Alex

For a reassignment, completion, reopen, or archive, use the same pattern with `ASSIGN`, `COMPLETE`, `REOPEN`, or `ARCHIVE`. Use internal notes only for admin-confidential details. Before editing a task that may be active, reopen or refresh it. Avoid having two people edit the same details simultaneously.

This convention makes the reason readable inside the task. It does not prevent overwrites or notify coworkers.

## Product changes recommended before a larger team

1. **Optimistic concurrency:** add a task revision number. Every edit/move/lifecycle action submits the revision it opened. If it changed, reject the stale write and show “Blair updated this task; review the new version before saving.”
2. **Live board synchronization:** broadcast task changes or poll a lightweight change feed so open boards update without navigation. Show a non-disruptive “Updated by Alex” message.
3. **Move reason:** after a drag, offer a compact reason field and store it with the move event. The move can remain fast, but the reason should appear in the task timeline.
4. **Task timeline:** display activity metadata inside the task: actor, exact field changes, from/to columns, lifecycle action, and attached comment/reason. The global Activity page should expose those details too.
5. **Presence and edit awareness:** show “Alex is viewing” or “Blair is editing” before a person starts changing the same task.
6. **Mentions and notifications:** support `@name`, assignment notifications, and an in-app unread indicator. Email can be optional.
7. **Atomic lifecycle transitions:** complete, reopen, archive, and restore must compare the expected revision in the same database transaction so two stale actions cannot both succeed.

## Acceptance tests for collaboration work

- Two open boards receive a move within a few seconds without reload.
- A stale title save is rejected and shows who changed the task and what changed.
- Simultaneous Complete and Archive produce one winner and one readable conflict.
- Move reason appears beside the move event in the task timeline.
- A regular comment is visible to assigned staff; an internal note remains admin-only.
- Mentioned or newly assigned users receive one notification, including under repeated requests.

The isolated database and local server were removed after evidence was collected.
