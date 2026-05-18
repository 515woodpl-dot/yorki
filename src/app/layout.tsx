import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import { getSetting } from '@/lib/local-data'
import type { ThemeSettings } from '@/lib/types'
import { getAppThemeForNow, type AppThemeMode } from '@/lib/utils'
import ThemeScheduler from '@/components/theme/ThemeScheduler'
import ToastAutoDismiss from '@/components/system/ToastAutoDismiss'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Yorki',
  description: 'Internal task and request management',
  applicationName: 'Yorki',
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  themeColor: '#F6F3EE',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const themeSettings = await getSetting<ThemeSettings>('theme', { default_mode: 'auto' })
  const themeMode = (themeSettings?.default_mode ?? 'auto') as AppThemeMode
  const initialTheme = themeMode === 'auto' ? getAppThemeForNow() : themeMode

  return (
    <html lang="en" suppressHydrationWarning data-theme-mode={themeMode}>
      <head>
        <title>Yorki</title>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme={initialTheme} enableSystem={false} disableTransitionOnChange>
          <ThemeScheduler mode={themeMode} />
          <ToastAutoDismiss />
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              classNames: {
                toast: 'bg-card border border-border text-foreground',
                description: 'text-muted-foreground',
                error: 'border-destructive',
                success: 'border-green-500',
              },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
