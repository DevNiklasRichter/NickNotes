import { useCallback, useMemo, useState } from 'react'
import type { TagMatchCandidate } from '../contracts/apiContracts'

export type { TagMatchCandidate }

type TagMatchWorkflowState = {
  open: boolean
  loading: boolean
  applying: boolean
  cursor: number
  items: TagMatchCandidate[]
  skippedIds: string[]
}

const INITIAL_TAG_MATCH_WORKFLOW_STATE: TagMatchWorkflowState = {
  open: false,
  loading: false,
  applying: false,
  cursor: 0,
  items: [],
  skippedIds: [],
}

function visibleTagMatches(state: TagMatchWorkflowState): TagMatchCandidate[] {
  return state.items.filter((item) => !state.skippedIds.includes(item.id))
}

export function useTagMatchWorkflowState() {
  const [tagMatchWorkflow, setTagMatchWorkflow] = useState<TagMatchWorkflowState>(INITIAL_TAG_MATCH_WORKFLOW_STATE)

  const visibleTagMatchItems = useMemo(() => visibleTagMatches(tagMatchWorkflow), [tagMatchWorkflow])
  const activeTagMatch =
    visibleTagMatchItems.length > 0
      ? visibleTagMatchItems[Math.min(tagMatchWorkflow.cursor, visibleTagMatchItems.length - 1)]
      : null

  const openTagMatchWorkflowLoading = useCallback(() => {
    setTagMatchWorkflow({
      open: true,
      loading: true,
      applying: false,
      cursor: 0,
      items: [],
      skippedIds: [],
    })
  }, [])

  const resolveTagMatchWorkflowCandidates = useCallback((items: TagMatchCandidate[]) => {
    setTagMatchWorkflow((current) => ({
      ...current,
      loading: false,
      cursor: 0,
      items,
      skippedIds: [],
    }))
  }, [])

  const stopTagMatchWorkflowLoading = useCallback(() => {
    setTagMatchWorkflow((current) => ({ ...current, loading: false }))
  }, [])

  const closeTagMatchWorkflow = useCallback(() => {
    setTagMatchWorkflow((current) => current.applying ? current : { ...current, open: false })
  }, [])

  const moveTagMatchCursor = useCallback((direction: 1 | -1) => {
    setTagMatchWorkflow((current) => {
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
      const skippedIds = current.skippedIds.includes(match.id)
        ? current.skippedIds
        : [...current.skippedIds, match.id]
      const visibleCount = current.items.filter((item) => !skippedIds.includes(item.id)).length
      return {
        ...current,
        skippedIds,
        cursor: Math.max(0, Math.min(current.cursor, visibleCount - 1)),
      }
    })
  }, [])

  const setTagMatchApplying = useCallback((applying: boolean) => {
    setTagMatchWorkflow((current) => ({ ...current, applying }))
  }, [])

  const removeAppliedTagMatches = useCallback((matches: TagMatchCandidate[]) => {
    setTagMatchWorkflow((current) => {
      const appliedIds = new Set(matches.map((item) => item.id))
      const items = current.items.filter((item) => !appliedIds.has(item.id))
      return {
        ...current,
        applying: false,
        items,
        cursor: Math.max(0, Math.min(current.cursor, items.length - 1)),
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
    setTagMatchApplying,
    removeAppliedTagMatches,
  }
}
