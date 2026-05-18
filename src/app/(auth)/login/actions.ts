'use server'

import { loginWithPassword } from '@/lib/auth'

export async function signIn(email: string, password: string) {
  return loginWithPassword(email, password)
}
