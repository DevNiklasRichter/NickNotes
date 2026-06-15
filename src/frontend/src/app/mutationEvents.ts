import type { GraphIndexStatus } from '../app/AppShared'

export type MutationEventKind =
  | 'note-saved'
  | 'note-created'
  | 'note-renamed'
  | 'note-moved'
  | 'note-deleted'
  | 'note-group-mutated'
  | 'notes-batch-updated'
  | 'tag-mutated'
  | 'capture-saved'
  | 'todo-updated'
  | 'focus-updated'
  | 'import-completed'

export type MutationRefreshPlan = {
  search?: boolean
  tasks?: boolean
  todos?: boolean
  review?: boolean
  noteGroups?: boolean
  explorerSidebar?: boolean
  focusAggregate?: boolean
}

export type AppMutationEvent = {
  kind: MutationEventKind
  noteType?: 'note' | 'task'
  paths?: string[]
  graphStatus?: GraphIndexStatus
  refresh?: MutationRefreshPlan
}
