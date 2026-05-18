import { getBackupHistory, getSettings } from '@/lib/actions/settings'
import type { AppThemeMode } from '@/lib/utils'
import SettingsClient from './SettingsClient'

export default async function SettingsPage() {
  const { theme } = await getSettings()
  const backupHistory = await getBackupHistory()
  const initialThemeMode = (theme?.default_mode ?? 'auto') as AppThemeMode

  return <SettingsClient initialThemeMode={initialThemeMode} backupHistory={backupHistory} />
}
