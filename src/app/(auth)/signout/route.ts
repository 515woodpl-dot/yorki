import { destroySession } from '@/lib/auth'
import { isSameOrigin, seeOther } from '@/lib/form-post'

/** Sign out. A plain form post, so the button works even if the page's JavaScript did not load. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return seeOther('/login')
  await destroySession()
  return seeOther('/login')
}
