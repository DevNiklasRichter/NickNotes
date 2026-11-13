import {useSyncedDraft} from './useSyncedDraft'
import { useEffect, useId, useLayoutEffect, useRef } from 'react'
import {MultiSelectPicker} from '../ui/MultiSelectPicker'
import type { CSSProperties, KeyboardEvent, RefObject } from 'react'
import type { ParsedNoteDocument, TaskPriority, TaskStatus } from './noteDocument'

type NotePropertiesPanelProps = {
  draftCommitters: RefObject<Map<string, () => boolean>>
  onAddTag: (value: string) => boolean
  onAddRelated: (value: string) => boolean
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
  taskIdOptions: string[]
  tagVisualByKey: Map<string, { label: string; color: string }>
  taskAdvancedHandlingEnabled: boolean
  taskTimeManagementEnabled: boolean
  taskFieldErrors?: { estimate_minutes?: string; follow_up_date?: string }
  formatTimestamp: (value: string) => string
  onTitleChange: (next: string) => void
  onTitleBlur: (next: string) => void
  onTypeChange: (next: 'note' | 'task') => void
  onStatusChange: (next: TaskStatus) => void
  onPriorityChange: (next: TaskPriority) => void
  onDueDateChange: (next: string) => void
  onRemoveDueDate: () => void
  onEstimateMinutesChange: (next: string) => boolean
  onBlockedByIdsChange: (next: string) => void
  onWaitingForChange: (next: string) => void
  onFollowUpDateChange: (next: string) => boolean
  onBlockedReasonChange: (next: string) => void
  onNextActionHintChange: (next: string) => void
  onOpenTagOverview?: (tag: string) => void
  onRemoveTag: (tag: string) => void
  onRemoveRelated: (related: string) => void
}

export function NotePropertiesPanel({
  draftCommitters, onAddTag, onAddRelated,
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
  taskIdOptions,
  tagVisualByKey,
  taskAdvancedHandlingEnabled,
  taskTimeManagementEnabled,
  taskFieldErrors,
  formatTimestamp,
  onTitleChange,
  onTitleBlur,
  onTypeChange,
  onStatusChange,
  onPriorityChange,
  onDueDateChange,
  onRemoveDueDate,
  onEstimateMinutesChange,
  onBlockedByIdsChange,
  onWaitingForChange,
  onFollowUpDateChange,
  onBlockedReasonChange,
  onNextActionHintChange,
  onOpenTagOverview,
  onRemoveTag,
  onRemoveRelated,
}: NotePropertiesPanelProps) {
  const [titleDraft, setTitleDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.title)
  const [estimateDraft, setEstimateDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.estimate_minutes ? String(document.frontmatter.estimate_minutes) : '')
  const [blockedByIdsDraft, setBlockedByIdsDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.blocked_by_ids.join(', '))
  const [waitingForDraft, setWaitingForDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.waiting_for)
  const [followUpDateDraft, setFollowUpDateDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.follow_up_date)
  const [blockedReasonDraft, setBlockedReasonDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.blocked_reason)
  const [nextActionHintDraft, setNextActionHintDraft] = useSyncedDraft(document.frontmatter.id || tabPath, document.frontmatter.next_action_hint)
  const titleInputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const titleInput = titleInputRef.current
    if (!titleInput) {
      return
    }
    const fit = () => {
      titleInput.style.height = '0px'
      titleInput.style.height = `${titleInput.scrollHeight}px`
    }
    fit()
    let frame = 0
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(fit)
    })
    observer.observe(titleInput)
    return () => {observer.disconnect(); window.cancelAnimationFrame(frame)}
  }, [titleDraft, tabPath])

  const manualTags = document.frontmatter.tags
  const manualTagSet = new Set(manualTags)
  const autoTags = document.frontmatter.tags_auto.filter((item) => !manualTagSet.has(item))
  const manualRelated = document.frontmatter.related
  const manualRelatedSet = new Set(manualRelated)
  const autoRelated = document.frontmatter.related_auto.filter((item) => !manualRelatedSet.has(item))
  const panelId = useId()
  const blockerDatalistId = `${panelId}-blockers`
  const estimatePresets = [5, 15, 30, 60, 90, 120]

  const toTagChipVisual = (rawTag: string): { label: string; color: string } => {
    const normalized = rawTag.trim().toLowerCase()
    const mapped = tagVisualByKey.get(normalized)
    if (mapped) {
      return mapped
    }
    const tagPart = rawTag.includes(':') ? rawTag.split(':', 2)[1] || rawTag : rawTag
    return { label: tagPart, color: '#94a3b8' }
  }

  useLayoutEffect(() => {
    const commits = draftCommitters.current
    commits.set(panelId, () => {
      let valid = true
      if (titleDraft !== document.frontmatter.title) onTitleChange(titleDraft)
      if (document.frontmatter.type !== 'task') return true
      if (taskTimeManagementEnabled && (taskFieldErrors?.estimate_minutes || estimateDraft !== (document.frontmatter.estimate_minutes ? String(document.frontmatter.estimate_minutes) : ''))) valid = onEstimateMinutesChange(estimateDraft) && valid
      if (!taskAdvancedHandlingEnabled) return valid
      if (blockedByIdsDraft !== document.frontmatter.blocked_by_ids.join(', ')) onBlockedByIdsChange(blockedByIdsDraft)
      if (waitingForDraft !== document.frontmatter.waiting_for) onWaitingForChange(waitingForDraft)
      if (taskFieldErrors?.follow_up_date || followUpDateDraft !== document.frontmatter.follow_up_date) valid = onFollowUpDateChange(followUpDateDraft) && valid
      if (blockedReasonDraft !== document.frontmatter.blocked_reason) onBlockedReasonChange(blockedReasonDraft)
      if (nextActionHintDraft !== document.frontmatter.next_action_hint) onNextActionHintChange(nextActionHintDraft)
      return valid
    })
    return () => {commits.delete(panelId)}
  })

  const onTaskInputKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, source: string, reset: (value: string) => void) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      reset(source)
      event.currentTarget.value = source
      event.currentTarget.blur()
    } else if (event.key === 'Enter' && event.currentTarget instanceof HTMLInputElement) {
      event.preventDefault()
      event.currentTarget.blur()
    }
  }

  return (
    <section aria-label="Notizeigenschaften" className={`note-properties-panel ${compact ? 'split-note-properties-panel' : ''}`}>
      <div className="note-title-row">
        <textarea
          ref={titleInputRef}
          className="note-title-input note-title-textarea"
          aria-label="Notiztitel"
          rows={1}
          value={titleDraft}
          onChange={(event) => {
            const normalizedTitle = event.target.value.replace(/\r?\n/g, ' ')
            if (normalizedTitle !== event.target.value) {
              event.currentTarget.value = normalizedTitle
            }
            setTitleDraft(normalizedTitle)
            event.currentTarget.style.height = '0px'
            event.currentTarget.style.height = `${event.currentTarget.scrollHeight}px`
          }}
          onBlur={(event) => {
            if (event.currentTarget.value !== document.frontmatter.title) onTitleChange(event.currentTarget.value)
            onTitleBlur(event.currentTarget.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.currentTarget.blur()
            }
          }}
          placeholder="Untitled"
        />
      </div>
      <h2 className="note-properties-heading">Eigenschaften</h2>

      <div className={`note-properties-grid ${compact ? 'compact' : ''}`}>
        <span className="property-key">Typ</span>
        <div className="property-toggle-group" role="group" aria-label="Dokumenttyp">
          <button
            type="button"
            className={`property-toggle-badge ${document.frontmatter.type === 'note' ? 'active' : ''}`}
            aria-pressed={document.frontmatter.type === 'note'}
            onClick={() => {
              onTypeChange('note')
            }}
          >
            Notiz
          </button>
          <button
            type="button"
            className={`property-toggle-badge ${document.frontmatter.type === 'task' ? 'active' : ''}`}
            aria-pressed={document.frontmatter.type === 'task'}
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
                  aria-label="Status"
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

            <span className="property-key">Priorität</span>
            <div className="property-value-inline">
              <label className="property-picker-badge">
                <span className={taskPriorityDotClassName(document.frontmatter.priority)} aria-hidden="true" />
                <select
                  className="property-picker-select property-picker-select-priority"
                  aria-label="Priorität"
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

            <span className="property-key">Fälligkeit</span>
            <div className="property-value-inline">
              <input
                className="property-date-input"
                type="date"
                aria-label="Fälligkeitsdatum"
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
                  aria-label="Fälligkeitsdatum entfernen" data-tooltip="Faelligkeitsdatum entfernen"
                >
                  x
                </button>
              ) : null}
            </div>

            {taskTimeManagementEnabled ? (
              <>
                <span className="property-key">Schätzung</span>
                <div className="property-value-stack">
                  <div className="property-value-inline">
                    <input
                      className="property-number-input"
                  aria-label="Schätzung in Minuten"
                      type="number"
                      min={1}
                      step={5}
                      aria-invalid={!!taskFieldErrors?.estimate_minutes}
                      aria-describedby={taskFieldErrors?.estimate_minutes ? `${panelId}-estimate_minutes-error` : undefined}
                      value={estimateDraft}
                      onChange={(event) => {
                        setEstimateDraft(event.target.value)
                      }}
                      onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.estimate_minutes ? String(document.frontmatter.estimate_minutes) : '') || taskFieldErrors?.estimate_minutes) onEstimateMinutesChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.estimate_minutes ? String(document.frontmatter.estimate_minutes) : '', setEstimateDraft)}
                      placeholder="z. B. 30"
                    />
                    {document.frontmatter.estimate_minutes ? (
                      <button
                        type="button"
                        className="property-chip add"
                        onClick={() => {
                          setEstimateDraft('')
                          onEstimateMinutesChange('')
                        }}
                        aria-label="Schätzung entfernen" data-tooltip="Schaetzung entfernen"
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                  <div className="property-chip-row">
                    {estimatePresets.map((preset) => (
                      <button
                        key={`estimate-${preset}`}
                        type="button"
                        className="property-chip property-chip-action"
                        onClick={() => {
                          const value = String(preset)
                          setEstimateDraft(value)
                          onEstimateMinutesChange(value)
                        }}
                      >
                        {preset}m
                      </button>
                    ))}
                  </div>
                  {taskFieldErrors?.estimate_minutes ? <span id={`${panelId}-estimate_minutes-error`} className="property-inline-error" role="alert">{taskFieldErrors.estimate_minutes}</span> : null}
                </div>
              </>
            ) : null}

            {taskAdvancedHandlingEnabled ? (
              <>
                <span className="property-key">Blockiert durch</span>
                <div className="property-value-inline">
                  <input
                    className="property-text-input"
                    list={blockerDatalistId}
                    aria-label="Blockiert durch (Task-IDs)"
                    value={blockedByIdsDraft}
                    onChange={(event) => {
                      setBlockedByIdsDraft(event.target.value)
                    }}
                    onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.blocked_by_ids.join(', '))) onBlockedByIdsChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.blocked_by_ids.join(', '), setBlockedByIdsDraft)}
                    placeholder="Task-IDs, mit Komma trennen"
                  />
                  <datalist id={blockerDatalistId}>
                    {taskIdOptions.map((taskId) => (
                      <option key={taskId} value={taskId} />
                    ))}
                  </datalist>
                </div>

                <span className="property-key">Warten auf</span>
                <div className="property-value-inline">
                  <input
                    className="property-text-input"
                    aria-label="Warten auf"
                    value={waitingForDraft}
                    onChange={(event) => {
                      setWaitingForDraft(event.target.value)
                    }}
                    onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.waiting_for)) onWaitingForChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.waiting_for, setWaitingForDraft)}
                    placeholder="z. B. Rueckmeldung Team"
                  />
                </div>

                <span className="property-key">Wiedervorlage</span>
                <div className="property-value-stack">
                  <div className="property-value-inline">
                    <input
                      className="property-date-input"
                      type="date"
                      aria-label="Wiedervorlagedatum"
                    aria-invalid={!!taskFieldErrors?.follow_up_date}
                      aria-describedby={taskFieldErrors?.follow_up_date ? `${panelId}-follow_up_date-error` : undefined}
                      value={followUpDateDraft}
                      onChange={(event) => {
                        setFollowUpDateDraft(event.target.value)
                      }}
                      onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.follow_up_date) || taskFieldErrors?.follow_up_date) onFollowUpDateChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.follow_up_date, setFollowUpDateDraft)}
                    />
                    {document.frontmatter.follow_up_date ? (
                      <button
                        type="button"
                        className="property-chip add"
                        onClick={() => {
                          setFollowUpDateDraft('')
                          onFollowUpDateChange('')
                        }}
                        aria-label="Wiedervorlagedatum entfernen" data-tooltip="Follow-up entfernen"
                      >
                        x
                      </button>
                    ) : null}
                  </div>
                  {taskFieldErrors?.follow_up_date ? <span id={`${panelId}-follow_up_date-error`} className="property-inline-error" role="alert">{taskFieldErrors.follow_up_date}</span> : null}
                </div>

                <span className="property-key">Blockierungsgrund</span>
                <div className="property-value-inline">
                  <textarea
                    className="property-textarea-input"
                    rows={2}
                    aria-label="Blockierungsgrund"
                    value={blockedReasonDraft}
                    onChange={(event) => {
                      setBlockedReasonDraft(event.target.value)
                    }}
                    onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.blocked_reason)) onBlockedReasonChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.blocked_reason, setBlockedReasonDraft)}
                    placeholder="Warum blockiert?"
                  />
                </div>

                <span className="property-key">Nächster Schritt</span>
                <div className="property-value-inline">
                  <textarea
                    className="property-textarea-input"
                    rows={2}
                    aria-label="Nächster Schritt"
                    value={nextActionHintDraft}
                    onChange={(event) => {
                      setNextActionHintDraft(event.target.value)
                    }}
                    onBlur={event => {
                        if (event.currentTarget.value !== (document.frontmatter.next_action_hint)) onNextActionHintChange(event.currentTarget.value)
                      }}
                      onKeyDown={event => onTaskInputKeyDown(event, document.frontmatter.next_action_hint, setNextActionHintDraft)}
                    placeholder="Naechster konkreter Schritt"
                  />
                </div>
              </>
            ) : null}
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
                data-tooltip={item}
              >
                <button
                  type="button"
                  className="property-chip-link"
                  onClick={() => {
                    onOpenTagOverview?.(item)
                  }}
                  data-tooltip={`Tag-Overview oeffnen (${item})`}
                >
                  {visual.label}
                </button>
                <button
                  type="button"
                  className="property-chip-remove"
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemoveTag(item)
                  }}
                  aria-label={`Tag ${item} entfernen`} data-tooltip="Tag entfernen"
                >
                  x
                </button>
              </span>
            )
          })}
          {autoTags.map((item) => {
            const visual = toTagChipVisual(item)
            return (
              <button
                type="button"
                key={`tag-auto-${item}`}
                className="property-chip tag-chip auto property-chip-link-button"
                style={{ '--tag-chip-color': visual.color } as CSSProperties}
                data-tooltip={`Automatisch erkannt - ${item}`}
                onClick={() => {
                  onOpenTagOverview?.(item)
                }}
              >
                {visual.label}
              </button>
            )
          })}
          <MultiSelectPicker label="Tags bearbeiten" triggerText="+" selectedValues={manualTags}
            options={Array.from(new Set([...propertyTagOptions, ...manualTags])).map(value => ({value, label: `${toTagChipVisual(value).label} (${value})`, color: toTagChipVisual(value).color}))}
            emptySelectionLabel="Keine manuellen Tags" onAddValue={onAddTag}
            onToggle={value => {if (manualTags.includes(value)) onRemoveTag(value); else onAddTag(value)}}/>

        </div>

        <span className="property-key">Verknüpfungen</span>
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
                aria-label={`Verknüpfung ${item} entfernen`} data-tooltip="Link entfernen"
              >
                x
              </button>
            </span>
          ))}
          {autoRelated.map((item) => (
            <span key={`related-auto-${item}`} className="property-chip auto" data-tooltip="Automatisch erkannt">
              {item}
            </span>
          ))}
          <MultiSelectPicker label="Verknüpfungen bearbeiten" triggerText="+" selectedValues={manualRelated}
            options={Array.from(new Set([...relatedOptions, ...manualRelated])).map(value => ({value, label: value}))}
            emptySelectionLabel="Keine manuellen Verknüpfungen" onAddValue={onAddRelated}
            onToggle={value => {if (manualRelated.includes(value)) onRemoveRelated(value); else onAddRelated(value)}}/>

        </div>

        <span className="property-key">Erstellt</span>
        <span className="property-value-static">{formatTimestamp(document.frontmatter.created_at)}</span>

        <span className="property-key">Aktualisiert</span>
        <span className="property-value-static">{formatTimestamp(document.frontmatter.updated_at)}</span>
      </div>
    </section>
  )
}
