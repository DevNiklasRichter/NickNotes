import {afterEach, expect, test, vi} from 'vitest'
afterEach(() => {vi.unstubAllGlobals(); vi.resetModules()})
test('late responses from an earlier NoteBase never reach a caller', async () => {
  let resolve!: (response: Response) => void
  vi.stubGlobal('window',{nicknotes:{getBackendToken:async ()=>'secret'}})
  vi.stubGlobal('fetch',vi.fn(() => new Promise<Response>(done => {resolve=done})))
  const client=await import('./apiClient')
  const pending=client.apiRequest('http://127.0.0.1:8765','/state')
  await vi.waitFor(() => expect(resolve).toBeDefined())
  client.beginSessionSwitch()
  resolve(new Response(JSON.stringify({vaultLoaded:true}),{headers:{'X-NoteBase-Session':'old'}}))
  await expect(pending).rejects.toMatchObject({code:'session.stale'})
})
test('all calls carry app credentials; session IDs are never URL parameters', async () => {
  vi.stubGlobal('window',{nicknotes:{getBackendToken:async ()=>'secret'}})
  const fetch=vi.fn<typeof globalThis.fetch>().mockImplementation(async () => new Response('{}',{headers:{'X-NoteBase-Session':'current'}}))
  vi.stubGlobal('fetch',fetch)
  const client=await import('./apiClient')
  await client.apiRequest('http://127.0.0.1:8765','/state')
  await client.apiRequest('http://127.0.0.1:8765','/notes/content?path=Note.md')
  const headers=fetch.mock.calls[1]?.[1]?.headers as Headers
  expect(headers.get('Authorization')).toBe('Bearer secret')
  expect(headers.get('X-NoteBase-Session')).toBe('current')
})
test('an unreachable service is reported in plain words instead of a raw TypeError', async () => {
  vi.stubGlobal('window',{nicknotes:{getBackendToken:async ()=>'secret'}})
  vi.stubGlobal('fetch',vi.fn(async () => {throw new TypeError('Failed to fetch')}))
  const client=await import('./apiClient')
  await expect(client.apiRequest('http://127.0.0.1:8765','/state')).rejects.toMatchObject({code:'service.unreachable',message:expect.stringContaining('nicht erreichbar')})
})
