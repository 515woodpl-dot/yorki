import { NextResponse } from 'next/server'
import { loginWithPassword } from '@/lib/auth'
import { BASE_PATH, isSameOrigin, seeOther } from '@/lib/form-post'

/** Plain form post: works with or without JavaScript. Wrong details come back to the form with a message. */
export async function POST(request: Request) {
  if (!isSameOrigin(request)) return seeOther('/login', { error: 'Sign in failed. Please try again.' })
  const form = await request.formData().catch(() => null)
  const email = String(form?.get('email') ?? '').trim().toLowerCase()
  const password = String(form?.get('password') ?? '')
  if (!email || !password) return seeOther('/login', { error: 'Enter your email and password.', email })

  const result = await loginWithPassword(email, password)
  if (!result.success) return seeOther('/login', { error: result.error, email })

  const response = new NextResponse(null, { status: 303, headers: { Location: `${BASE_PATH}/dashboard`, 'Cache-Control': 'no-store' } })
  return response
}
