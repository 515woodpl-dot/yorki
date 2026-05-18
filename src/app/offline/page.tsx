export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-8 text-center shadow-lg">
        <p className="text-sm font-medium uppercase tracking-[0.3em] text-muted-foreground">Yorki</p>
        <h1 className="mt-4 text-3xl font-semibold">You&apos;re offline</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Reconnect to load live tasks, comments, and uploads.
        </p>
      </div>
    </main>
  )
}
