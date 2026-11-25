const { test } = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { load, plain } = require('./load-ts.cjs')

test('comment recipients include all assignees once, with mentions separated', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE notifications (id TEXT, user_id TEXT, actor_id TEXT, task_id TEXT, comment_id TEXT, type TEXT, snippet TEXT, created_at TEXT, read_at TEXT)`)
  const users = Object.fromEntries(['author', 'submitter', 'assignee1', 'assignee2', 'admin', 'inactive'].map(id => [id, {
    id, role: id === 'admin' ? 'admin' : 'staff', is_active: id !== 'inactive', email: `${id}@example.com`,
  }]))
  const notifications = load('src/lib/notifications.ts', {
    './db': { getDb: () => db },
    './local-data': { findUser: id => users[id] ?? null },
    './utils': {
      getAssignedUserIds: task => task.custom_fields.assigned_user_ids,
      isTaskAssignedToUser: (task, id) => task.custom_fields.assigned_user_ids.includes(id),
    },
    './push/server': { queuePush() {} },
  })
  const task = { id: 'task', submitted_by: 'submitter', custom_fields: { assigned_user_ids: ['assignee1', 'assignee2', 'assignee2', 'inactive'] } }
  try {
    const result = notifications.notifyForComment({ task, commentId: 'comment', body: 'Please check @[Assignee 1](assignee1)', actorId: 'author', isInternal: false })
    assert.deepEqual(plain(result.mentioned.map(user => user.id)), ['assignee1'])
    assert.deepEqual(plain(result.others.map(user => user.id)), ['submitter', 'assignee2'])
    assert.deepEqual(db.prepare('SELECT user_id, type FROM notifications ORDER BY rowid').all(), [
      { user_id: 'assignee1', type: 'mention' }, { user_id: 'submitter', type: 'comment' }, { user_id: 'assignee2', type: 'comment' },
    ])

    const internal = notifications.notifyForComment({ task, commentId: 'private', body: 'Internal note', actorId: 'author', isInternal: true })
    assert.deepEqual(plain(internal.others.map(user => user.id)), [])
  } finally { db.close() }
})
