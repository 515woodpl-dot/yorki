#!/usr/bin/env node
/**
 * Draws the Yorki app icons (the same bold "Y" + steel-blue dot as the app header)
 * and writes them as PNG files. Vector shapes only, so it doesn't depend on any font.
 * The generated files are committed; rerun only when the artwork changes:
 *
 *   node scripts/generate-pwa-icons.cjs
 *
 * public/icons/icon-192.png       Android / desktop install icon
 * public/icons/icon-512.png       Android / desktop install icon, splash
 * public/icons/maskable-512.png   "maskable": extra padding so any phone's icon shape can crop it
 * src/app/icon.png                browser tab / bookmark icon (Next adds the <link>)
 * src/app/apple-icon.png          iPhone/iPad home-screen icon (Next adds the <link>)
 */
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const NAVY_TOP = '#33405F'
const NAVY_BOTTOM = '#222B45'
const CREAM = '#F6F3EE'
const STEEL = '#6A97C4'

/** The "Y" in a 100×100 box: two arms meeting in a stem. */
const Y = '8,6 30,6 50,38 70,6 92,6 61,52 61,94 39,94 39,52'

/**
 * @param size   canvas size in px
 * @param mark   how much of the canvas the Y box takes (0.58 = 58%)
 */
function svg(size, mark) {
  const box = size * mark
  const x = (size - box) / 2
  const y = (size - box) / 2 + size * 0.01 // optical centring: the Y reads slightly high otherwise
  const s = box / 100
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${NAVY_TOP}"/><stop offset="1" stop-color="${NAVY_BOTTOM}"/></linearGradient></defs>
  <rect width="${size}" height="${size}" fill="url(#g)"/>
  <g transform="translate(${x} ${y}) scale(${s})">
    <polygon points="${Y}" fill="${CREAM}"/>
    <rect x="68" y="60" width="17" height="17" rx="3" fill="${STEEL}"/>
  </g>
</svg>`
}

async function write(file, size, mark) {
  const out = path.join(ROOT, file)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await sharp(Buffer.from(svg(size, mark))).png({ compressionLevel: 9 }).toFile(out)
  console.log(`${file}  ${size}×${size}  (${fs.statSync(out).size} bytes)`)
}

;(async () => {
  await write('public/icons/icon-192.png', 192, 0.56)
  await write('public/icons/icon-512.png', 512, 0.56)
  // Maskable: everything important inside the central 80% circle → mark ≤ ~50% of the canvas.
  await write('public/icons/maskable-512.png', 512, 0.46)
  await write('src/app/icon.png', 512, 0.56)
  await write('src/app/apple-icon.png', 180, 0.56)
})()
