# Super-admin hard-mode report — 2026-11-16

Scope: destructive local testing against temporary SQLite databases and the local production build. The live Droplet and its data were not touched. The test agent exercised task lifecycle actions, public sharing, users, roles, columns, comments, attachments, malformed inputs, repeated requests, and permission boundaries.

## Confirmed and fixed in the release branch

| Severity | Defect | Resolution |
| --- | --- | --- |
| Critical | Archiving preserved a public share token. Replaying `reopenTask` or `completeTask` against the archived task made its old public URL work again. | Archiving now revokes public share/recipient fields. Complete only accepts an active non-completed task; reopen only accepts a completed task. Archived work must use the explicit restore action. |
| High | `restoreTask` accepted live tasks, changed their status, and erased sharing metadata. | Restore now requires `status=archived`, validates the target column, clears stale completion time, revokes public sharing, and preserves assignment metadata. |
| High | Task create/update accepted blank titles, arbitrary priority/status, malformed dates, nonexistent columns, and oversized payloads. | Server-side validation now covers title, description, priority, status, due date, custom-field size, and destination column. |
| High | Deleting a user checked only the scalar assignee and missed IDs in multi-assignment metadata. | Deletion now scans active-task assignment metadata and refuses to leave a dangling assignment. |
| High | Last-admin protection used count-then-write operations that could race. | Role changes, deactivation, session revocation, and deletion now perform the invariant check and mutation inside an immediate SQLite transaction. |
| High | Columns accepted nonexistent boards, blank/very long names, unsafe colors, and duplicate names. | Create/update validates the board, normalized name, length, six-digit hex color, uniqueness, and record existence. |
| Medium | Blank or very large comments were accepted. | Comments require non-whitespace content and are limited to 20,000 characters. |
| Low | Updating a nonexistent column or deleting a nonexistent comment reported success and created misleading audit activity. | Data mutations now require a real active record and report `not found` otherwise. |

## Confirmed follow-up work

| Severity | Defect | Recommended work |
| --- | --- | --- |
| Medium | Status behavior is partly inferred from column names such as `Pending` and `Completed`. Renaming reserved columns can weaken transitions. | Add an immutable semantic column kind (`inbox`, `pending`, `in_progress`, `completed`, `archive`) and migrate status routing away from display names. Until then, avoid renaming workflow columns. |
| Medium | Soft-deleted tasks leave attachment rows and physical files for retention, but there is no purge/retention job. | Define a retention period, then add a reviewed purge operation that removes task attachments only from Yorki's private upload root and records the purge. Do not delete files immediately if recovery is required. |
| Medium | User names and some settings fields still lack consistent product-level length limits. | Add shared schemas for user, email, theme, and notification settings and show field-specific UI errors. |

## Behaviors that held up

- Anonymous users could not reach protected local pages or private attachments.
- Staff could not see unrelated tasks or internal notes and could not use admin actions.
- Super-admin protection blocked ordinary admins from resetting or managing a super-admin account.
- Self-deactivation, self-deletion, and deleting the final active administrator were blocked in ordinary sequential use.
- Opening and closing the task panel repeatedly did not reveal a separate lifecycle defect.
- File uploads enforced task access, MIME allow-list, size limits, private storage, and no-store downloads in the tested flows.

Regression tests cover the fixed public-link replay, invalid lifecycle replays, corrupt task inputs, invitation races, persistent login limits, staff boundaries, backup/restore, legacy private-file migration, and business-timezone date handling. The production browser suite covers real sign-in, task opening/closing, board/list/calendar views, filters, drag persistence, attachments, role boundaries, deactivation, and logout.
