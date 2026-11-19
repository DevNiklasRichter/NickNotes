/** Authenticated transport and session generation shared by every frontend feature. */
let token: Promise<string> | undefined
let session: string | null = null
let epoch = 0
const controllers = new Set<AbortController>()
export function beginSessionSwitch(): void {
  epoch += 1
  session = null
  for (const controller of controllers) controller.abort()
  controllers.clear()
}
export function connectionEpoch(): number { return epoch }
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
  toString(): string { return this.message }
}
export async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const started = epoch
  token ??= window.nicknotes?.getBackendToken?.() ?? Promise.resolve('')
  const headers = new Headers(init.headers)
  const credential = await token
  if (started !== epoch) throw new ApiError('Die NoteBase wurde gewechselt.', 'session.stale', 409)
  if (credential) headers.set('Authorization', `Bearer ${credential}`)
  const lifecycle = /\/(?:notebase|vault)\/(?:open|create|rename|delete)/.test(url)
  if (session && !lifecycle) headers.set('X-NoteBase-Session', session)
  const controller = new AbortController()
  controllers.add(controller)
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(/\/imports\/onenote\/start/.test(url) ? 20*60_000 : /\/reindex|\/graph-index\/rebuild/.test(url) ? 5*60_000 : 30_000), ...(init.signal ? [init.signal] : [])])
  try {
    let response: Response
    try {
      response = await fetch(url, { ...init, headers, signal })
    } catch (error) {
      // fetch reports an unreachable service only as "TypeError: Failed to fetch"; aborts and timeouts keep their own errors.
      if (error instanceof TypeError) throw new ApiError('Der lokale NickNotes-Dienst ist gerade nicht erreichbar. Er startet möglicherweise noch – bitte gleich noch einmal versuchen.', 'service.unreachable', 0)
      throw error
    }
    if (started !== epoch) throw new ApiError('Die NoteBase wurde gewechselt. Die alte Antwort wurde verworfen.', 'session.stale', 409)
    if (!response.ok) {
      const payload = await response.json().catch(() => null)
      throw new ApiError(payload?.error?.message ?? 'Die Anfrage konnte nicht verarbeitet werden.', payload?.error?.code ?? 'request.failed', response.status)
    }
    const next = response.headers.get('X-NoteBase-Session')
    if (session && next && session !== next && !lifecycle) throw new ApiError('Die NoteBase wurde gewechselt. Bitte die Ansicht erneut laden.', 'session.stale', 409)
    session = next ?? session
    return response
  } finally { controllers.delete(controller) }
}
export async function apiRequest<T>(baseUrl: string, endpoint: string, init: RequestInit = {}): Promise<T> {
  const started = epoch
  const headers = new Headers(init.headers)
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await authenticatedFetch(`${baseUrl}${endpoint}`, { ...init, headers })
  const result = await response.json()
  if (started !== epoch) throw new ApiError('Die NoteBase wurde gewechselt. Die alte Antwort wurde verworfen.', 'session.stale', 409)
  return result as T
}
