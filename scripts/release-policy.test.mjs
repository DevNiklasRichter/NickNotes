import {test} from 'node:test'
import assert from 'node:assert/strict'
import {validateRelease} from './release-policy.mjs'
const fixture=()=>({pkg:{version:'2.1.0',license:'MIT'},lock:{version:'2.1.0',packages:{'':{version:'2.1.0'}}},tag:'v2.1.0',license:'MIT License',notes:'# Changelog\n\n## [2.1.0]\n\nA verified release.\n\n## [2.0.0]\n\nOld.'})
test('release policy extracts only the version being released',()=>assert.equal(validateRelease(fixture()),'A verified release.'))
test('release policy refuses RCs, mismatched tags, lock drift, missing license and missing notes',()=>{
  for(const modify of [
    f=>{f.pkg.version='2.1.0-rc.4';f.tag='v2.1.0-rc.4'},
    f=>{f.tag='v2.2.0'},f=>{f.lock.packages[''].version='2.0.0'},
    f=>{f.pkg.license='UNLICENSED'},f=>{f.notes='# Changelog\n\n## [Unreleased]\nSoon.'},
    f=>{f.notes='# Changelog\n\nAdd `## [2.1.0]` before releasing.'},
    f=>{f.notes='## [2.1.0]\n\n## [2.0.0]\nOld.'},
  ]){const f=fixture();modify(f);assert.throws(()=>validateRelease(f))}
})
