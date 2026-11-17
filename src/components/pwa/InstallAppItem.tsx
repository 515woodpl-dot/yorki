'use client'

import { useEffect, useState } from 'react'
import { Download, Share, SquarePlus, X } from 'lucide-react'
import { isIosDevice, isStandalone, promptInstall, useInstallPrompt } from './install-store'

/**
 * "Install app" entry for the account menu.
 *  • Chrome / Edge / Android: one tap, uses the browser's own install prompt.
 *  • iPhone / iPad (Safari has no install prompt): shows the three steps.
 *  • Already installed, or a browser that can't install: shows nothing.
 */
export default function InstallAppItem({ className }: { className: string }) {
  const prompt = useInstallPrompt()
  const [ready, setReady] = useState(false)
  const [standalone, setStandalone] = useState(true) // assume installed until we know (no flash)
  const [ios, setIos] = useState(false)
  const [help, setHelp] = useState(false)

  useEffect(() => {
    setStandalone(isStandalone())
    setIos(isIosDevice())
    setReady(true)
  }, [])

  if (!ready || standalone || (!prompt && !ios)) return null

  return (
    <>
      <button type="button" className={className} onClick={() => (prompt ? void promptInstall() : setHelp(true))}>
        <Download size={17} aria-hidden="true" />Install app
      </button>
      {help && (
        <div role="dialog" aria-modal="true" aria-label="Add Yorki to your Home Screen" className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-base font-semibold text-foreground">Add Yorki to your Home Screen</h2>
              <button type="button" aria-label="Close" onClick={() => setHelp(false)} className="-mr-2 -mt-2 flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-accent"><X size={18} /></button>
            </div>
            <ol className="mt-3 space-y-3 text-sm text-foreground">
              <li className="flex items-start gap-3"><Share size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" /><span>Tap the <b>Share</b> button in Safari’s toolbar.</span></li>
              <li className="flex items-start gap-3"><SquarePlus size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" /><span>Scroll down and tap <b>Add to Home Screen</b>.</span></li>
              <li className="flex items-start gap-3"><Download size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-primary" /><span>Tap <b>Add</b>. Yorki opens full-screen, like an app.</span></li>
            </ol>
            <p className="mt-4 text-xs text-muted-foreground">Es: toca <b>Compartir</b> → <b>Añadir a pantalla de inicio</b> → <b>Añadir</b>.</p>
          </div>
        </div>
      )}
    </>
  )
}
