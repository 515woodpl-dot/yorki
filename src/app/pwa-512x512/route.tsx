import { ImageResponse } from 'next/og'

export const runtime = 'edge'
const size = {
  width: 512,
  height: 512,
}

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: 'linear-gradient(180deg, #2F3650 0%, #243149 100%)',
          color: '#F6F3EE',
          display: 'flex',
          fontSize: 248,
          fontWeight: 700,
          height: '100%',
          justifyContent: 'center',
          width: '100%',
        }}
      >
        Y
      </div>
    ),
    size,
  )
}
