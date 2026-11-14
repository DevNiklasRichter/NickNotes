import test from 'node:test'
import assert from 'node:assert/strict'
import {prepareChangelog} from './release-prepare.mjs'
import {validateRelease} from './release-policy.mjs'

const changelog='# Changelog\n\nIntro\n\n## [Unreleased]\n\n### Neu\n\n- Termine\n\n## [2.1.0] - 2026-11-20\n\n- Alt\n'

test('the unreleased notes become the dated section of the next version',()=>{
  const prepared=prepareChangelog(changelog,'2.2.0','2026-12-01')
  assert.equal(prepared,'# Changelog\n\nIntro\n\n## [Unreleased]\n\n## [2.2.0] - 2026-12-01\n\n### Neu\n\n- Termine\n\n## [2.1.0] - 2026-11-20\n\n- Alt\n')
  const pkg={version:'2.2.0',license:'MIT'},lock={version:'2.2.0',packages:{'':{version:'2.2.0'}}}
  assert.equal(validateRelease({pkg,lock,tag:'v2.2.0',license:'MIT License',notes:prepared}),'### Neu\n\n- Termine')
})
test('an empty unreleased section or an existing version is refused',()=>{
  assert.throws(()=>prepareChangelog('## [Unreleased]\n\n## [2.1.0]\n- Alt\n','2.2.0','2026-12-01'),/empty/)
  assert.throws(()=>prepareChangelog(changelog,'2.1.0','2026-12-01'),/already/)
  assert.throws(()=>prepareChangelog('# Changelog\n','2.2.0','2026-12-01'),/Unreleased/)
})
