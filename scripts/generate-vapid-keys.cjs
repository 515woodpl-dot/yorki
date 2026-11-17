#!/usr/bin/env node
/**
 * OPTIONAL. Push notifications work without this: Yorki creates its signing key automatically the
 * first time it is needed and keeps it in the database.
 *
 * Run this only if you'd rather manage the key yourself (for example to keep it in .env):
 *
 *   node scripts/generate-vapid-keys.cjs
 *
 * and add the two lines it prints to .env. IMPORTANT: if devices already turned notifications on,
 * changing the key stops delivery to them until they turn notifications on again.
 */
const { generateVAPIDKeys } = require('web-push')
const keys = generateVAPIDKeys()
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`)
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`)
console.log('# Optional: who the push services should contact (https URL or mailto:). Defaults to APP_URL.')
console.log('# VAPID_SUBJECT=mailto:you@example.com')
