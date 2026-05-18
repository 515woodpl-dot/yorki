import { getRecentActivityLogs } from '@/lib/actions/activity'
import { formatDateTime } from '@/lib/utils'

function formatAction(action: string) {
  return action.replace(/_/g, ' ')
}

function formatActor(name: string | null, email: string | null) {
  return name || email || 'System'
}

export default async function ActivityPage() {
  const entries = await getRecentActivityLogs(100)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground mb-1">Activity</h1>
        <p className="text-sm text-muted-foreground">Latest 100 system and task events</p>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Task</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-t border-border align-top">
                  <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDateTime(entry.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">
                      {formatActor(entry.actor_name, entry.actor_email)}
                    </div>
                    {entry.actor_email && <div className="text-xs text-muted-foreground">{entry.actor_email}</div>}
                  </td>
                  <td className="px-4 py-3 capitalize text-foreground">{formatAction(entry.action)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{entry.task_title ?? '—'}</td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                    No activity yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
