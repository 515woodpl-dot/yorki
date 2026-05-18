import { getColumns } from '@/lib/actions/settings'
import ColumnsClient from './ColumnsClient'

const DEFAULT_BOARD_ID = '00000000-0000-0000-0000-000000000001'

export default async function ColumnsPage() {
  const columns = await getColumns(DEFAULT_BOARD_ID)
  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Columns</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Manage your board columns. The Inbox and Archive columns cannot be deleted.
      </p>
      <ColumnsClient initialColumns={columns} boardId={DEFAULT_BOARD_ID} />
    </div>
  )
}
