import type { Dispatch, SetStateAction } from 'react'
import { normalizeTagColor } from './tagTypes'

export type TagActionDialogTone = 'default' | 'primary' | 'danger'

export type TagActionDialogAction = {
  id: string
  label: string
  tone?: TagActionDialogTone
}

export type TagGroupFormValues = {
  id: string
  displayName: string
  color: string
}

export type TagFormValues = {
  id: string
  displayName: string
}

export type TagActionDialogResult = {
  actionId: string
  value: string
  groupValues?: TagGroupFormValues
  tagValues?: TagFormValues
}

export type TagActionDialogState = {
  kind: 'input' | 'choice' | 'group-form' | 'tag-form' | 'color-form'
  title: string
  message?: string
  placeholder?: string
  value: string
  groupValues?: TagGroupFormValues
  tagValues?: TagFormValues
  actions: TagActionDialogAction[]
  resolve: (result: TagActionDialogResult) => void
}

type TagActionDialogModalProps = {
  dialog: TagActionDialogState | null
  colorPresets: string[]
  onClose: (actionId: string) => void
  setDialog: Dispatch<SetStateAction<TagActionDialogState | null>>
}

export function TagActionDialogModal({ dialog, colorPresets, onClose, setDialog }: TagActionDialogModalProps) {
  if (!dialog) {
    return null
  }

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        onClose('cancel')
      }}
    >
      <aside
        className="tag-action-modal"
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose('cancel')
            return
          }
          if (event.key === 'Enter') {
            const target = event.target
            if (target instanceof HTMLTextAreaElement) {
              return
            }
            event.preventDefault()
            onClose('confirm')
          }
        }}
      >
        <header className="sidebar-header-row">
          <h3>{dialog.title}</h3>
        </header>

        {dialog.message ? <p className="muted-copy">{dialog.message}</p> : null}

        {dialog.kind === 'input' ? (
          <input
            value={dialog.value}
            placeholder={dialog.placeholder}
            autoFocus
            onChange={(event) => {
              const nextValue = event.target.value
              setDialog((current) => (current ? { ...current, value: nextValue } : current))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                onClose('confirm')
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose('cancel')
              }
            }}
          />
        ) : null}

        {dialog.kind === 'group-form' ? (
          <div className="tag-form-grid">
            <label className="tag-form-label" htmlFor="tag-group-id">
              Gruppen-ID
            </label>
            <input
              id="tag-group-id"
              autoFocus
              value={dialog.groupValues?.id ?? ''}
              placeholder="z. B. projekt"
              onChange={(event) => {
                const nextValue = event.target.value
                setDialog((current) =>
                  current && current.kind === 'group-form'
                    ? {
                        ...current,
                        groupValues: {
                          id: nextValue,
                          displayName: current.groupValues?.displayName ?? '',
                          color: current.groupValues?.color ?? colorPresets[0],
                        },
                      }
                    : current
                )
              }}
            />

            <label className="tag-form-label" htmlFor="tag-group-display-name">
              Anzeigename
            </label>
            <input
              id="tag-group-display-name"
              value={dialog.groupValues?.displayName ?? ''}
              placeholder="z. B. Projekte"
              onChange={(event) => {
                const nextValue = event.target.value
                setDialog((current) =>
                  current && current.kind === 'group-form'
                    ? {
                        ...current,
                        groupValues: {
                          id: current.groupValues?.id ?? '',
                          displayName: nextValue,
                          color: current.groupValues?.color ?? colorPresets[0],
                        },
                      }
                    : current
                )
              }}
            />

            <label className="tag-form-label">Farbe</label>
            <div className="tag-color-picker-stack">
              <div className="tag-color-presets">
                {colorPresets.map((preset) => {
                  const isActive = normalizeTagColor(dialog.groupValues?.color ?? '') === normalizeTagColor(preset)
                  return (
                    <button
                      key={`tag-color-${preset}`}
                      type="button"
                      className={`tag-color-swatch ${isActive ? 'active' : ''}`}
                      style={{ backgroundColor: preset }}
                      onClick={() => {
                        setDialog((current) =>
                          current && current.kind === 'group-form'
                            ? {
                                ...current,
                                groupValues: {
                                  id: current.groupValues?.id ?? '',
                                  displayName: current.groupValues?.displayName ?? '',
                                  color: preset,
                                },
                              }
                            : current
                        )
                      }}
                      title={preset}
                      aria-label={`Farbe ${preset}`}
                    />
                  )
                })}
              </div>
              <div className="tag-color-custom-row">
                <input
                  type="color"
                  value={normalizeTagColor(dialog.groupValues?.color ?? colorPresets[0])}
                  onChange={(event) => {
                    const nextColor = normalizeTagColor(event.target.value)
                    setDialog((current) =>
                      current && current.kind === 'group-form'
                        ? {
                            ...current,
                            groupValues: {
                              id: current.groupValues?.id ?? '',
                              displayName: current.groupValues?.displayName ?? '',
                              color: nextColor,
                            },
                          }
                        : current
                    )
                  }}
                  aria-label="Benutzerdefinierte Farbe"
                />
                <span className="muted-copy">Eigene Farbe waehlen</span>
              </div>
            </div>
          </div>
        ) : null}

        {dialog.kind === 'tag-form' ? (
          <div className="tag-form-grid">
            <label className="tag-form-label" htmlFor="tag-id">
              Tag-ID
            </label>
            <input
              id="tag-id"
              autoFocus
              value={dialog.tagValues?.id ?? ''}
              placeholder="z. B. projekt-a"
              onChange={(event) => {
                const nextValue = event.target.value
                setDialog((current) =>
                  current && current.kind === 'tag-form'
                    ? {
                        ...current,
                        tagValues: {
                          id: nextValue,
                          displayName: current.tagValues?.displayName ?? '',
                        },
                      }
                    : current
                )
              }}
            />

            <label className="tag-form-label" htmlFor="tag-display-name">
              Anzeigename
            </label>
            <input
              id="tag-display-name"
              value={dialog.tagValues?.displayName ?? ''}
              placeholder="z. B. Projekt A"
              onChange={(event) => {
                const nextValue = event.target.value
                setDialog((current) =>
                  current && current.kind === 'tag-form'
                    ? {
                        ...current,
                        tagValues: {
                          id: current.tagValues?.id ?? '',
                          displayName: nextValue,
                        },
                      }
                    : current
                )
              }}
            />
          </div>
        ) : null}

        {dialog.kind === 'color-form' ? (
          <div className="tag-form-grid">
            <label className="tag-form-label">Farbe</label>
            <div className="tag-color-picker-stack">
              <div className="tag-color-presets">
                {colorPresets.map((preset) => {
                  const isActive = normalizeTagColor(dialog.groupValues?.color ?? '') === normalizeTagColor(preset)
                  return (
                    <button
                      key={`group-color-only-${preset}`}
                      type="button"
                      className={`tag-color-swatch ${isActive ? 'active' : ''}`}
                      style={{ backgroundColor: preset }}
                      onClick={() => {
                        setDialog((current) =>
                          current && current.kind === 'color-form'
                            ? {
                                ...current,
                                groupValues: {
                                  id: current.groupValues?.id ?? '',
                                  displayName: current.groupValues?.displayName ?? '',
                                  color: preset,
                                },
                              }
                            : current
                        )
                      }}
                      title={preset}
                      aria-label={`Farbe ${preset}`}
                    />
                  )
                })}
              </div>
              <div className="tag-color-custom-row">
                <input
                  type="color"
                  autoFocus
                  value={normalizeTagColor(dialog.groupValues?.color ?? colorPresets[0])}
                  onChange={(event) => {
                    const nextColor = normalizeTagColor(event.target.value)
                    setDialog((current) =>
                      current && current.kind === 'color-form'
                        ? {
                            ...current,
                            groupValues: {
                              id: current.groupValues?.id ?? '',
                              displayName: current.groupValues?.displayName ?? '',
                              color: nextColor,
                            },
                          }
                        : current
                    )
                  }}
                  aria-label="Benutzerdefinierte Farbe"
                />
                <span className="muted-copy">Eigene Farbe waehlen</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="tag-action-modal-actions">
          {dialog.actions.map((action) => (
            <button
              key={`tag-action-${action.id}`}
              className={`tag-action-button ${action.tone === 'danger' ? 'danger' : ''} ${
                action.tone === 'primary' ? 'primary' : ''
              }`}
              onClick={() => {
                onClose(action.id)
              }}
            >
              {action.label}
            </button>
          ))}
        </div>
      </aside>
    </div>
  )
}

