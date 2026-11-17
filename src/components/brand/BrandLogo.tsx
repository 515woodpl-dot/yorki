import { cn } from '@/lib/utils'

const APP_BASE_PATH = process.env.NODE_ENV === 'production' ? '/task' : ''

/**
 * The Yorki logo. The lettering is dark navy, so on the dark theme we show a copy with light
 * lettering (public/Yorki-light.png); CSS picks the right one, so there is no flash.
 */
export default function BrandLogo({ className }: { className?: string }) {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${APP_BASE_PATH}/Yorki.png`} alt="Yorki" className={cn('w-auto dark:hidden', className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${APP_BASE_PATH}/Yorki-light.png`} alt="" aria-hidden="true" className={cn('hidden w-auto dark:block', className)} />
    </>
  )
}
