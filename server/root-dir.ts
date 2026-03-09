import { existsSync } from 'node:fs'
import path from 'node:path'

export function resolveRootDir(fromDir: string): string {
  const candidates = [path.resolve(fromDir, '..'), path.resolve(fromDir, '..', '..')]

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'expenses', 'schema.sql'))) {
      return candidate
    }
  }

  return candidates[0] || fromDir
}
