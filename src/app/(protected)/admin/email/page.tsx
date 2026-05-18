import { getSettings } from '@/lib/actions/settings'
import EmailSettingsForm from './EmailSettingsForm'

export default async function EmailSettingsPage() {
  const { email } = await getSettings()
  return (
    <div>
      <h1 className="text-xl font-semibold mb-1">Email</h1>
      <p className="text-sm text-muted-foreground mb-6">
        Configure notification recipients and trigger events
      </p>
      <EmailSettingsForm settings={email} />
    </div>
  )
}
