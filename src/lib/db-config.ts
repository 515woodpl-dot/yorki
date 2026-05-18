import path from 'node:path'

const DEFAULT_DB_DIR_NAME = 'data'
const DEFAULT_DB_FILE_NAME = 'yorki.db'

function resolveDbDir() {
  const explicitPath = process.env.YORKI_DB_PATH?.trim()
  if (explicitPath) {
    return path.dirname(path.resolve(explicitPath))
  }

  const explicitDir = process.env.YORKI_DB_DIR?.trim()
  if (explicitDir) {
    return path.resolve(explicitDir)
  }

  return path.join(process.cwd(), DEFAULT_DB_DIR_NAME)
}

function resolveDbPath() {
  const explicitPath = process.env.YORKI_DB_PATH?.trim()
  if (explicitPath) {
    return path.resolve(explicitPath)
  }

  return path.join(resolveDbDir(), DEFAULT_DB_FILE_NAME)
}

export const YORKI_DB_DIR = resolveDbDir()
export const YORKI_DB_PATH = resolveDbPath()
