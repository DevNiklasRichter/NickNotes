import {test} from 'node:test'
import assert from 'node:assert/strict'
import {isViteReady} from './vite-readiness.mjs'

const plain='VITE v8.3.6 ready in 259 ms\n  ➜  Local:   http://localhost:5173/\n'
const colored='\x1b[32mVITE\x1b[39m v8.3.6 ready in 259 ms\r\n  ➜  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m\r\n'

test('recognizes plain and ANSI-colored Vite local URLs',()=>{
  assert.equal(colored.includes('Local:'),false) // The previous smoke readiness check failed here.
  assert.equal(isViteReady(plain),true)
  assert.equal(isViteReady(colored),true)
})
test('waits until the complete local URL arrives, even across color/URL chunks',()=>{
  const split=colored.indexOf('Local')+2
  assert.equal(isViteReady(colored.slice(0,split)),false)
  assert.equal(isViteReady(colored.slice(0,split)+colored.slice(split)),true)
  assert.equal(isViteReady('Local: http://localhost:51'),false)
  assert.equal(isViteReady('Local: http://localhost:51'+'73/'),true)
})
test('rejects a banner, a network URL, or a different local address',()=>{
  assert.equal(isViteReady('VITE ready in 259 ms'),false)
  assert.equal(isViteReady('Network: http://localhost:5173/'),false)
  assert.equal(isViteReady('Local: http://localhost:5174/\nError: http://localhost:5173/'),false)
  assert.equal(isViteReady('Local: http://localhost:5173/other'),false)
  assert.equal(isViteReady('Local: http://127.0.0.1:15173/','http://127.0.0.1:15173/'),true)
})
