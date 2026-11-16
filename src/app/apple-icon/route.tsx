import { ImageResponse } from 'next/og'

const size = {
  width: 180,
  height: 180,
}

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#2F3650',
          color: '#F6F3EE',
          display: 'flex',
          fontSize: 88,
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
