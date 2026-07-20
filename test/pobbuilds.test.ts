import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listBuildFiles } from '../src/main/pobBuilds.ts'

test('lists PoB build xmls recursively with folder prefixes', () => {
  const dir = join(tmpdir(), `pob-builds-${process.pid}`)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, 'League Starters'), { recursive: true })
  writeFileSync(join(dir, 'My Witch.xml'), '<PathOfBuilding/>')
  writeFileSync(join(dir, 'League Starters', 'RF Chieftain.xml'), '<PathOfBuilding/>')
  writeFileSync(join(dir, 'notes.txt'), 'not a build')

  const files = listBuildFiles(dir)
  assert.deepEqual(files.map((f) => f.name).sort(), ['League Starters/RF Chieftain', 'My Witch'])
  assert.ok(files.every((f) => f.mtime > 0))

  assert.deepEqual(listBuildFiles(join(dir, 'does-not-exist')), [])
  rmSync(dir, { recursive: true, force: true })
})
