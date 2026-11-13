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

export function mutationRefreshPlan(event:AppMutationEvent):MutationRefreshPlan {
  if(event.refresh)return event.refresh
  switch (event.kind) {
      case 'note-saved':
          return {
              search: true,
              tasks: event.noteType === 'task',
              todos: true,
              review: true,
              noteGroups: true,
              explorerSidebar: true,
          };
      case 'note-created':
      case 'note-renamed':
      case 'note-moved':
      case 'note-deleted':
          return {
              search: true,
              tasks: true,
              todos: true,
              review: true,
              noteGroups: true,
              explorerSidebar: true,
          };
      case 'note-group-mutated':
          return {
              search: true,
              noteGroups: true,
              explorerSidebar: true,
          };
      case 'notes-batch-updated':
          return {
              search: true,
              tasks: true,
              todos: true,
              review: true,
              explorerSidebar: true,
          };
      case 'tag-mutated':
          return {
              search: true,
              review: true,
          };
      case 'capture-saved':
          return {
              search: true,
              todos: true,
              review: true,
              noteGroups: true,
              explorerSidebar: true,
          };
      case 'todo-updated':
          return {
              search: true,
              tasks: true,
              todos: true,
              review: true,
          };
      case 'focus-updated':
          return {
              focusAggregate: true,
              review: true,
          };
      case 'import-completed':
          return {
              search: true,
              tasks: true,
              todos: true,
              review: true,
              noteGroups: true,
              explorerSidebar: true,
          };
      default:
          return {};
  }
}

export function mutationAffectsGraph(event:AppMutationEvent):boolean {
  if(event.graphStatus)return true
  switch (event.kind) {
      case 'note-saved':
      case 'note-created':
      case 'note-renamed':
      case 'note-moved':
      case 'note-deleted':
      case 'note-group-mutated':
      case 'notes-batch-updated':
      case 'tag-mutated':
      case 'capture-saved':
      case 'import-completed':
          return true;
      default:
          return false;
  }
}
