#!/usr/bin/env node
/**
 * The Yorki logo's lettering is dark navy, which is nearly invisible on the dark theme.
 * This writes public/Yorki-light.png: the same artwork with the lettering turned light.
 * The woven symbol (left) and the bronze dot are left exactly as they are.
 *
 *   node scripts/generate-logo-light.cjs
 *
 * Re-run it if public/Yorki.png changes. The app shows Yorki.png in light mode and
 * Yorki-light.png in dark mode (src/components/brand/BrandLogo.tsx).
 */
const path = require('node:path')
const sharp = require('sharp')

const SOURCE = path.join(__dirname, '..', 'public', 'Yorki.png')
const OUTPUT = path.join(__dirname, '..', 'public', 'Yorki-light.png')
/** x where the lettering starts (the symbol ends at about x = 365 in the 1084 px wide artwork). */
const LETTERING_STARTS_AT = 368
const LIGHT = [233, 238, 248]

;(async () => {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let changed = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = LETTERING_STARTS_AT; x < info.width; x++) {
      const i = (y * info.width + x) * 4
      if (data[i + 3] === 0) continue
      const [r, , b] = [data[i], data[i + 1], data[i + 2]]
      if (r - b > 25) continue // the bronze dot over the "i" stays bronze
      data[i] = LIGHT[0]; data[i + 1] = LIGHT[1]; data[i + 2] = LIGHT[2] // keep alpha: edges stay smooth
      changed += 1
    }
  }
  await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(OUTPUT)
  console.log(`public/Yorki-light.png  ${info.width}×${info.height}  (${changed} pixels recoloured)`)
})()
