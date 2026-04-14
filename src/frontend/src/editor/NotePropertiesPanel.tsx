import type { CSSProperties, KeyboardEvent } from 'react'
import type { ParsedNoteDocument, TaskPriority, TaskStatus } from './noteDocument'

type NotePropertiesPanelProps = {
  tabPath: string
  document: ParsedNoteDocument
  compact?: boolean
  taskStatusOptions: Array<{ value: TaskStatus; label: string }>
  taskPriorityOptions: Array<{ value: TaskPriority; label: string }>
  taskStatusDotClassName: (raw: string) => string
  taskPriorityDotClassName: (raw: string) => string
  taskStatusOptionLabel: (value: TaskStatus) => string
  taskPriorityOptionLabel: (value: TaskPriority) => string
  propertyTagOptions: string[]
  relatedOptions: string[]
  tagVisualByKey: Map<string, { label: string; color: string }>
  tagInputOpen: boolean
  tagDraft: string
  relatedInputOpen: boolean
  relatedDraft: string
  formatTimestamp: (value: string) => string
  onTitleChange: (next: string) => void
  onTitleBlur: (next: string) => void
  onTypeChange: (next: 'note' | 'task') => void
  onStatusChange: (next: TaskStatus) => void
  onPriorityChange: (next: TaskPriority) => void
  onDueDateChange: (next: string) => void
  onRemoveDueDate: () => void
  onRemoveTag: (tag: string) => void
  onOpenTagInput: () => void
  onTagDraftChange: (value: string) => void
  onCommitTagInput: () => void
  onCloseTagInput: () => void
  onRemoveRelated: (related: string) => void
  onOpenRelatedInput: () => void
  onRelatedDraftChange: (value: string) => void
  onCommitRelatedInput: () => void
  onCloseRelatedInput: () => void
}

export function NotePropertiesPanel({
  tabPath,
  document,
  compact = false,
  taskStatusOptions,
  taskPriorityOptions,
  taskStatusDotClassName,
  taskPriorityDotClassName,
  taskStatusOptionLabel,
  taskPriorityOptionLabel,
  propertyTagOptions,
  relatedOptions,
  tagVisualByKey,
  tagInputOpen,
  tagDraft,
  relatedInputOpen,
  relatedDraft,
  formatTimestamp,
  onTitleChange,
  onTitleBlur,
  onTypeChange,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onRemoveDueDate,
  onRemoveTag,
  onOpenTagInput,
  onTagDraftChange,
  onCommitTagInput,
  onCloseTagInput,
  onRemoveRelated,
  onOpenRelatedInput,
  onRelatedDraftChange,
  onCommitRelatedInput,
  onCloseRelatedInput,
}: NotePropertiesPanelProps) {
  const manualTags = document.frontmatter.tags
  const manualTagSet = new Set(manualTags)
  const autoTags = document.frontmatter.tags_auto.filter((item) => !manualTagSet.has(item))
  const manualRelated = document.frontmatter.related
  const manualRelatedSet = new Set(manualRelated)
  const autoRelated = document.frontmatter.related_auto.filter((item) => !manualRelatedSet.has(item))
  const listToken = tabPath.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()
  const tagDatalistId = `property-tags-${listToken}`
  const relatedDatalistId = `property-related-${listToken}`

  const toTagChipVisual = (rawTag: string): { label: string; color: string } => {
    const normalized = rawTag.trim().toLowerCase()
    const mapped = tagVisualByKey.get(normalized)
    if (mapped) {
      return mapped
    }
    const tagPart = rawTag.includes(':') ? rawTag.split(':', 2)[1] || rawTag : rawTag
    return { label: tagPart, color: '#94a3b8' }
  }

  const onTagInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault()
      onCommitTagInput()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCloseTagInput()
    }
  }

  const onRelatedInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault()
      onCommitRelatedInput()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCloseRelatedInput()
    }
  }

  return (
    <section className={`note-properties-panel ${compact ? 'split-note-properties-panel' : ''}`}>
      <div className="note-title-row">
        <input
          className="note-title-input"
          value={document.frontmatter.title}
          onChange={(event) => {
            onTitleChange(event.target.value)
          }}
          onBlur={(event) => {
            onTitleBlur(event.currentTarget.value)
          }}
          placeholder="Untitled"
        />
      </div>
      <h2 className="note-properties-heading">Properties</h2>

      <div className={`note-properties-grid ${compact ? 'compact' : ''}`}>
        <span className="property-key">Type</span>
        <div className="property-toggle-group">
          <button
            type="button"
            className={`property-toggle-badge ${document.frontmatter.type === 'note' ? 'active' : ''}`}
            onClick={() => {
              onTypeChange('note')
            }}
          >
            Note
          </button>
          <button
            type="button"
            className={`property-toggle-badge ${document.frontmatter.type === 'task' ? 'active' : ''}`}
            onClick={() => {
              onTypeChange('task')
            }}
          >
            Task
          </button>
        </div>

        {document.frontmatter.type === 'task' ? (
          <>
            <span className="property-key">Status</span>
            <div className="property-value-inline">
              <label className="property-picker-badge">
                <span className={taskStatusDotClassName(document.frontmatter.status)} aria-hidden="true" />
                <select
                  className="property-picker-select property-picker-select-status"
                  value={document.frontmatter.status}
                  onChange={(event) => {
                    const value = event.target.value as TaskStatus
                    if (taskStatusOptions.some((entry) => entry.value === value)) {
                      onStatusChange(value)
                    }
                  }}
                >
                  {taskStatusOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {taskStatusOptionLabel(entry.value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <span className="property-key">Priority</span>
            <div className="property-value-inline">
              <label className="property-picker-badge">
                <span className={taskPriorityDotClassName(document.frontmatter.priority)} aria-hidden="true" />
                <select
                  className="property-picker-select property-picker-select-priority"
                  value={document.frontmatter.priority}
                  onChange={(event) => {
                    const value = event.target.value as TaskPriority
                    if (taskPriorityOptions.some((entry) => entry.value === value)) {
                      onPriorityChange(value)
                    }
                  }}
                >
                  {taskPriorityOptions.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {taskPriorityOptionLabel(entry.value)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <span className="property-key">Due Date</span>
            <div className="property-value-inline">
              <input
                className="property-date-input"
                type="date"
                value={document.frontmatter.due_date}
                onChange={(event) => {
                  onDueDateChange(event.target.value)
                }}
              />
              {document.frontmatter.due_date ? (
                <button
                  type="button"
                  className="property-chip add"
                  onClick={() => {
                    onRemoveDueDate()
                  }}
                  title="Faelligkeitsdatum entfernen"
                >
                  x
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        <span className="property-key">Tags</span>
        <div className="property-token-line">
          {manualTags.map((item) => {
            const visual = toTagChipVisual(item)
            return (
              <span
                key={`tag-manual-${item}`}
                className="property-chip tag-chip manual interactive"
                style={{ '--tag-chip-color': visual.color } as CSSProperties}
                title={item}
              >
                <span>{visual.label}</span>
                <button
                  type="button"
                  className="property-chip-remove"
                  onClick={() => {
                    onRemoveTag(item)
                  }}
                  title="Tag entfernen"
                >
                  x
                </button>
              </span>
            )
          })}
          {autoTags.map((item) => {
            const visual = toTagChipVisual(item)
            return (
              <span
                key={`tag-auto-${item}`}
                className="property-chip tag-chip auto"
                style={{ '--tag-chip-color': visual.color } as CSSProperties}
                title={`Automatisch erkannt â€¢ ${item}`}
              >
                {visual.label}
              </span>
            )
          })}
          {tagInputOpen ? (
            <>
              <input
                className="property-chip-input"
                list={tagDatalistId}
                value={tagDraft}
                onChange={(event) => {
                  onTagDraftChange(event.target.value)
                }}
                onKeyDown={onTagInputKeyDown}
                onBlur={() => {
                  onCommitTagInput()
                }}
                placeholder="tag..."
                autoFocus
              />
              <datalist id={tagDatalistId}>
                {propertyTagOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </>
          ) : null}
          <button
            type="button"
            className="property-chip add"
            onClick={() => {
              onOpenTagInput()
            }}
            title="Tag hinzufuegen"
          >
            +
          </button>
        </div>

        <span className="property-key">Related</span>
        <div className="property-token-line">
          {manualRelated.map((item) => (
            <span key={`related-manual-${item}`} className="property-chip manual interactive">
              <span>{item}</span>
              <button
                type="button"
                className="property-chip-remove"
                onClick={() => {
                  onRemoveRelated(item)
                }}
                title="Link entfernen"
              >
                x
              </button>
            </span>
          ))}
          {autoRelated.map((item) => (
            <span key={`related-auto-${item}`} className="property-chip auto" title="Automatisch erkannt">
              {item}
            </span>
          ))}
          {relatedInputOpen ? (
            <>
              <input
                className="property-chip-input"
                list={relatedDatalistId}
                value={relatedDraft}
                onChange={(event) => {
                  onRelatedDraftChange(event.target.value)
                }}
                onKeyDown={onRelatedInputKeyDown}
                onBlur={() => {
                  onCommitRelatedInput()
                }}
                placeholder="note/link..."
                autoFocus
              />
              <datalist id={relatedDatalistId}>
                {relatedOptions.map((item) => (
                  <option key={item} value={item} />
                ))}
              </datalist>
            </>
          ) : null}
          <button
            type="button"
            className="property-chip add"
            onClick={() => {
              onOpenRelatedInput()
            }}
            title="Verknuepfung hinzufuegen"
          >
            +
          </button>
        </div>

        <span className="property-key">Created</span>
        <span className="property-value-static">{formatTimestamp(document.frontmatter.created_at)}</span>

        <span className="property-key">Updated</span>
        <span className="property-value-static">{formatTimestamp(document.frontmatter.updated_at)}</span>
      </div>
    </section>
  )
}
