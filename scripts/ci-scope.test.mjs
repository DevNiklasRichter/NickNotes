import test from 'node:test'
import assert from 'node:assert/strict'
import {ciScope} from './ci-scope.mjs'
test('documentation avoids packaging while source, deployment and release inputs require it',()=>{
  assert.deepEqual(ciScope(['README.md','doc/assets/proof.png']),{code:false,package:false})
  assert.deepEqual(ciScope(['scripts/platform-paths.test.mjs']),{code:true,package:false})
  assert.deepEqual(ciScope(['src/frontend/src/app/commands.test.ts','src/backend/tests/test_runtime.py']),{code:true,package:false})
  assert.deepEqual(ciScope(['src/frontend/templates/Note.md']),{code:true,package:true})
  for(const file of ['src/desktop/main.mjs','src/frontend/public/startup.js','requirements-build.txt','electron-builder.yml','package-lock.json','.github/workflows/windows.yml','scripts/verify-package.mjs','CHANGELOG.md'])assert.deepEqual(ciScope([file]),{code:true,package:true},file)
  assert.deepEqual(ciScope(['README.md'],{full:true}),{code:true,package:true})
})
