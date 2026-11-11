import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { TagMatchCandidate } from '../contracts/apiContracts'

export type { TagMatchCandidate }

type TagMatchWorkflowState = {
  open: boolean
  loading: boolean
  applying: boolean
  cursor: number
  items: TagMatchCandidate[]
  skippedIds: string[]
  error: string
  status: string
  needsRescan: boolean
}

const INITIAL_TAG_MATCH_WORKFLOW_STATE: TagMatchWorkflowState = {
  open: false,
  loading: false,
  applying: false,
  cursor: 0,
  items: [],
  skippedIds: [],
  error: '',
  status: '',
  needsRescan: false,
}

function visibleTagMatches(state: TagMatchWorkflowState): TagMatchCandidate[] {
  return state.items.filter((item) => !state.skippedIds.includes(item.id))
}

export function useTagMatchWorkflowState() {
  const [tagMatchWorkflow, setTagMatchWorkflow] = useState<TagMatchWorkflowState>(INITIAL_TAG_MATCH_WORKFLOW_STATE)
  const operation = useRef<{phase: 'closed' | 'loading' | 'ready' | 'applying' | 'stale'; scan: AbortController | null}>({phase: 'closed', scan: null})
  useEffect(() => () => {operation.current.scan?.abort()}, [])

  const visibleTagMatchItems = useMemo(() => visibleTagMatches(tagMatchWorkflow), [tagMatchWorkflow])
  const activeTagMatch =
    visibleTagMatchItems.length > 0
      ? visibleTagMatchItems[Math.min(tagMatchWorkflow.cursor, visibleTagMatchItems.length - 1)]
      : null

  const openTagMatchWorkflowLoading = useCallback(() => {
    if (operation.current.phase === 'applying' || operation.current.phase === 'loading') return null
    const controller = new AbortController()
    operation.current = {phase: 'loading', scan: controller}
    setTagMatchWorkflow({
      ...INITIAL_TAG_MATCH_WORKFLOW_STATE, open: true, loading: true,
    })
    return controller.signal
  }, [])

  const resolveTagMatchWorkflowCandidates = useCallback((signal: AbortSignal, items: TagMatchCandidate[]) => {
    if (signal.aborted || operation.current.scan?.signal !== signal) return false
    operation.current = {phase: 'ready', scan: null}
    setTagMatchWorkflow((current) => ({
      ...current,
      loading: false,
      cursor: 0,
      items,
      skippedIds: [],
    }))
    return true
  }, [])

  const stopTagMatchWorkflowLoading = useCallback((signal: AbortSignal, error: string) => {
    if (signal.aborted || operation.current.scan?.signal !== signal) return false
    operation.current = {phase: 'ready', scan: null}
    setTagMatchWorkflow((current) => ({ ...current, loading: false, error }))
    return true
  }, [])

  const closeTagMatchWorkflow = useCallback(() => {
    if (operation.current.phase === 'applying') return
    operation.current.scan?.abort()
    operation.current = {phase: 'closed', scan: null}
    setTagMatchWorkflow(INITIAL_TAG_MATCH_WORKFLOW_STATE)
  }, [])

  const moveTagMatchCursor = useCallback((direction: 1 | -1) => {
    setTagMatchWorkflow((current) => {
      if (current.loading || current.applying) return current
      const visibleCount = visibleTagMatches(current).length
      if (visibleCount <= 0) {
        return current
      }
      return {
        ...current,
        cursor: (current.cursor + direction + visibleCount) % visibleCount,
      }
    })
  }, [])

  const skipTagMatch = useCallback((match: TagMatchCandidate | null) => {
    if (!match) {
      return
    }
    setTagMatchWorkflow((current) => {
      if (current.loading || current.applying) return current
      const skippedIds = current.skippedIds.includes(match.id)
        ? current.skippedIds
        : [...current.skippedIds, match.id]
      const visibleCount = current.items.filter((item) => !skippedIds.includes(item.id)).length
      return {
        ...current,
        skippedIds,
        cursor: Math.max(0, Math.min(current.cursor, visibleCount - 1)),
        status: 'Fundstelle für diesen Prüfdurchlauf übersprungen. Die Datei bleibt unverändert.',
      }
    })
  }, [])

  const beginTagMatchApply = useCallback(() => {
    if (operation.current.phase !== 'ready') return false
    operation.current.phase = 'applying'
    setTagMatchWorkflow((current) => ({ ...current, applying: true, error: '', status: '' }))
    return true
  }, [])

  const finishTagMatchApply = useCallback((error = '', status = '', needsRescan = false) => {
    operation.current.phase = needsRescan ? 'stale' : 'ready'
    setTagMatchWorkflow((current) => ({ ...current, applying: false, error, status, needsRescan }))
  }, [])

  const removeAppliedTagMatches = useCallback((matches: TagMatchCandidate[]) => {
    setTagMatchWorkflow((current) => {
      const appliedIds = new Set(matches.map((item) => item.id))
      const items = current.items.filter((item) => !appliedIds.has(item.id))
      return {
        ...current,
        items,
        cursor: Math.max(0, Math.min(current.cursor, items.filter(item => !current.skippedIds.includes(item.id)).length - 1)),
      }
    })
  }, [])

  return {
    tagMatchWorkflow,
    visibleTagMatchItems,
    activeTagMatch,
    openTagMatchWorkflowLoading,
    resolveTagMatchWorkflowCandidates,
    stopTagMatchWorkflowLoading,
    closeTagMatchWorkflow,
    moveTagMatchCursor,
    skipTagMatch,
    beginTagMatchApply,
    finishTagMatchApply,
    removeAppliedTagMatches,
  }
}
