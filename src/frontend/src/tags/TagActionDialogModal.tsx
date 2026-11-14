import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
  groupId?: string
  newGroupId?: string
  newGroupDisplayName?: string
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
  tagGroupOptions?: Array<{ id: string; displayName: string }>
  actions: TagActionDialogAction[]
  resolve: (result: TagActionDialogResult) => void
}

const CREATE_NEW_TAG_GROUP_VALUE = '__create-new-tag-group__'

type TagActionDialogModalProps = {
  dialog: TagActionDialogState | null
  colorPresets: string[]
  onClose: (actionId: string) => void
  setDialog: Dispatch<SetStateAction<TagActionDialogState | null>>
}

const TAG_ID_INPUT_HINT =
  'Erlaubt sind nur a-z, 0-9 und "-". Umlaute, Sonderzeichen und Leerzeichen sind für Tag-IDs nicht erlaubt.'

type ColorSelectionSource = 'preset' | 'custom'

type TagColorPickerProps = {
  colorPresets: string[]
  selectedColor: string
  onSelectColor: (color: string) => void
}

function sanitizeTagIdInput(value: string): { cleanValue: string; rejectedInvalidChar: boolean } {
  const rejectedInvalidChar = /[^A-Za-z0-9-]/.test(value)
  return {
    cleanValue: value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    rejectedInvalidChar,
  }
}

function TagColorPicker({ colorPresets, selectedColor, onSelectColor }: TagColorPickerProps) {
  const normalizedPresets = useMemo(() => colorPresets.map((preset) => normalizeTagColor(preset)), [colorPresets])
  const normalizedSelectedColor = normalizeTagColor(selectedColor || normalizedPresets[0] || '')
  const selectedPresetIndex = normalizedPresets.findIndex((preset) => preset === normalizedSelectedColor)
  const [customColor, setCustomColor] = useState(() =>
    selectedPresetIndex >= 0 ? normalizedPresets[0] || normalizedSelectedColor : normalizedSelectedColor
  )
  const [selectionSource, setSelectionSource] = useState<ColorSelectionSource>(() =>
    selectedPresetIndex >= 0 ? 'preset' : 'custom'
  )

  const commitCustomColor = (rawColor: string) => {
    const nextColor = normalizeTagColor(rawColor)
    setCustomColor(nextColor)
    setSelectionSource('custom')
    onSelectColor(nextColor)
  }

  const updateCustomDraft = (rawColor: string) => {
    setCustomColor(normalizeTagColor(rawColor))
    setSelectionSource('custom')
  }

  return (
    <div className="tag-color-options">
      <div className="tag-color-preset-grid" aria-label="Voreingestellte Farben">
        {colorPresets.map((preset, index) => {
          const normalizedPreset = normalizedPresets[index] || normalizeTagColor(preset)
          const isActive = selectionSource === 'preset' && normalizedSelectedColor === normalizedPreset
          return (
            <button
              key={`tag-color-${preset}`}
              type="button"
              className={`tag-color-swatch ${isActive ? 'active' : ''}`}
              style={{ backgroundColor: preset }}
              onClick={() => {
                setSelectionSource('preset')
                onSelectColor(normalizedPreset)
              }}
              data-tooltip={preset}
              aria-label={`Farbe ${preset}`}
            />
          )
        })}
      </div>
      <div className="tag-color-custom-panel">
        <span className="tag-color-custom-heading">Eigene Farbe</span>
        <label className={`tag-color-custom-option ${selectionSource === 'custom' ? 'active' : ''}`} data-tooltip={customColor}>
          <input
            type="color"
            className="tag-color-custom-input"
            defaultValue={customColor}
            onClick={(event) => {
              commitCustomColor(event.currentTarget.value)
            }}
            onInput={(event) => {
              updateCustomDraft(event.currentTarget.value)
            }}
            onChange={(event) => {
              updateCustomDraft(event.currentTarget.value)
            }}
            onBlur={(event) => {
              if (selectionSource === 'custom') {
                commitCustomColor(event.currentTarget.value)
              }
            }}
            aria-label="Eigene Farbe auswählen"
          />
        </label>
      </div>
    </div>
  )
}

export function TagActionDialogModal({ dialog, colorPresets, onClose, setDialog }: TagActionDialogModalProps) {
  const modalRef = useRef<HTMLElement>(null)
  const identity = dialog?.resolve
  const focusInitial = useEffectEvent(() => {
    const modal = modalRef.current
    if (!modal || !dialog) return
    const target = dialog.kind === 'choice'
      ? modal.querySelector<HTMLElement>('[data-tag-action="cancel"]')
      : modal.querySelector<HTMLElement>('input,select,textarea')
    ;(target ?? modal).focus({preventScroll: true})
  })
  useLayoutEffect(() => {
    const modal = modalRef.current
    if (!identity || !modal) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const fallback = previous?.closest<HTMLElement>('.tag-explorer-shell')
    focusInitial()
    return () => {
      if (document.activeElement !== document.body && !modal.contains(document.activeElement)) return
      const target = previous?.isConnected ? previous : fallback?.isConnected ? fallback : null
      target?.focus({preventScroll: true})
    }
  }, [identity])
  const [hintState, setHintState] = useState<{
    dialogKind: TagActionDialogState['kind'] | null
    groupIdHintVisible: boolean
    tagIdHintVisible: boolean
  }>({
    dialogKind: null,
    groupIdHintVisible: false,
    tagIdHintVisible: false,
  })
  const activeDialogKind = dialog?.kind ?? null
  const groupIdHintVisible = hintState.dialogKind === activeDialogKind && hintState.groupIdHintVisible
  const tagIdHintVisible = hintState.dialogKind === activeDialogKind && hintState.tagIdHintVisible
  const setGroupIdHintVisible = (visible: boolean) => {
    setHintState((current) => ({
      dialogKind: activeDialogKind,
      groupIdHintVisible: visible,
      tagIdHintVisible: current.dialogKind === activeDialogKind ? current.tagIdHintVisible : false,
    }))
  }
  const setTagIdHintVisible = (visible: boolean) => {
    setHintState((current) => ({
      dialogKind: activeDialogKind,
      groupIdHintVisible: current.dialogKind === activeDialogKind ? current.groupIdHintVisible : false,
      tagIdHintVisible: visible,
    }))
  }

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
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={dialog.title}
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={event => {
          event.stopPropagation()
          if (event.key === 'Escape') {event.preventDefault(); onClose('cancel'); return}
          if (event.key === 'Tab') {
            const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('input,select,textarea,button')]
              .filter(node => !node.matches(':disabled,[hidden]') && node.getClientRects().length > 0)
            const first = controls[0], last = controls[controls.length - 1]
            if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus()}
            else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus()}
          }
          // Native buttons retain their own action, including Cancel and destructive choices.
          if (event.key === 'Enter' && event.target instanceof HTMLInputElement && event.target.type === 'text'
              && dialog.actions.some(action => action.id === 'confirm')) {
            event.preventDefault(); onClose('confirm')
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
            onChange={(event) => {
              const nextValue = event.target.value
              setDialog((current) => (current ? { ...current, value: nextValue } : current))
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
              value={dialog.groupValues?.id ?? ''}
              placeholder="z. B. projekt"
              onChange={(event) => {
                const { cleanValue, rejectedInvalidChar } = sanitizeTagIdInput(event.target.value)
                setGroupIdHintVisible(rejectedInvalidChar)
                setDialog((current) =>
                  current && current.kind === 'group-form'
                    ? {
                        ...current,
                        groupValues: {
                          id: cleanValue,
                          displayName: current.groupValues?.displayName ?? '',
                          color: current.groupValues?.color ?? colorPresets[0],
                        },
                      }
                    : current
                )
              }}
            />
            {groupIdHintVisible ? <p className="tag-form-hint">{TAG_ID_INPUT_HINT}</p> : null}

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
              <TagColorPicker
                colorPresets={colorPresets}
                selectedColor={dialog.groupValues?.color ?? colorPresets[0]}
                onSelectColor={(nextColor) => {
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
              />
            </div>
          </div>
        ) : null}

        {dialog.kind === 'tag-form' ? (
          <div className="tag-form-grid">
            {dialog.tagValues?.groupId !== undefined ? (
              <>
                <label className="tag-form-label" htmlFor="tag-group-select">
                  Tag-Gruppe
                </label>
                <select
                  id="tag-group-select"
                  value={dialog.tagValues.groupId}
                  onChange={(event) => {
                    const nextGroupId = event.target.value
                    setDialog((current) =>
                      current && current.kind === 'tag-form'
                        ? {
                            ...current,
                            tagValues: {
                              groupId: nextGroupId,
                              newGroupId: current.tagValues?.newGroupId ?? '',
                              newGroupDisplayName: current.tagValues?.newGroupDisplayName ?? '',
                              id: current.tagValues?.id ?? '',
                              displayName: current.tagValues?.displayName ?? '',
                            },
                          }
                        : current
                    )
                  }}
                >
                  {(dialog.tagGroupOptions ?? []).map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.displayName} ({group.id})
                    </option>
                  ))}
                  <option value={CREATE_NEW_TAG_GROUP_VALUE}>Neue Tag-Gruppe erstellen ...</option>
                </select>
                {dialog.tagValues.groupId === CREATE_NEW_TAG_GROUP_VALUE ? (
                  <>
                    <label className="tag-form-label" htmlFor="new-tag-group-id">
                      Neue Gruppen-ID
                    </label>
                    <input
                      id="new-tag-group-id"
                      value={dialog.tagValues.newGroupId ?? ''}
                      placeholder="z. B. person"
                      onChange={(event) => {
                        const { cleanValue, rejectedInvalidChar } = sanitizeTagIdInput(event.target.value)
                        setGroupIdHintVisible(rejectedInvalidChar)
                        setDialog((current) =>
                          current && current.kind === 'tag-form'
                            ? {
                                ...current,
                                tagValues: {
                                  groupId: current.tagValues?.groupId,
                                  newGroupId: cleanValue,
                                  newGroupDisplayName: current.tagValues?.newGroupDisplayName ?? '',
                                  id: current.tagValues?.id ?? '',
                                  displayName: current.tagValues?.displayName ?? '',
                                },
                              }
                            : current
                        )
                      }}
                    />
                    {groupIdHintVisible ? <p className="tag-form-hint">{TAG_ID_INPUT_HINT}</p> : null}

                    <label className="tag-form-label" htmlFor="new-tag-group-display-name">
                      Gruppen-Anzeigename
                    </label>
                    <input
                      id="new-tag-group-display-name"
                      value={dialog.tagValues.newGroupDisplayName ?? ''}
                      placeholder="z. B. Personen"
                      onChange={(event) => {
                        const nextValue = event.target.value
                        setDialog((current) =>
                          current && current.kind === 'tag-form'
                            ? {
                                ...current,
                                tagValues: {
                                  groupId: current.tagValues?.groupId,
                                  newGroupId: current.tagValues?.newGroupId ?? '',
                                  newGroupDisplayName: nextValue,
                                  id: current.tagValues?.id ?? '',
                                  displayName: current.tagValues?.displayName ?? '',
                                },
                              }
                            : current
                        )
                      }}
                    />
                  </>
                ) : null}
              </>
            ) : null}

            <label className="tag-form-label" htmlFor="tag-id">
              Tag-ID
            </label>
            <input
              id="tag-id"
              value={dialog.tagValues?.id ?? ''}
              placeholder="z. B. projekt-a"
              onChange={(event) => {
                const { cleanValue, rejectedInvalidChar } = sanitizeTagIdInput(event.target.value)
                setTagIdHintVisible(rejectedInvalidChar)
                setDialog((current) =>
                  current && current.kind === 'tag-form'
                    ? {
                        ...current,
                        tagValues: {
                          groupId: current.tagValues?.groupId,
                          newGroupId: current.tagValues?.newGroupId,
                          newGroupDisplayName: current.tagValues?.newGroupDisplayName,
                          id: cleanValue,
                          displayName: current.tagValues?.displayName ?? '',
                        },
                      }
                    : current
                )
              }}
            />
            {tagIdHintVisible ? <p className="tag-form-hint">{TAG_ID_INPUT_HINT}</p> : null}

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
                          groupId: current.tagValues?.groupId,
                          newGroupId: current.tagValues?.newGroupId,
                          newGroupDisplayName: current.tagValues?.newGroupDisplayName,
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
              <TagColorPicker
                colorPresets={colorPresets}
                selectedColor={dialog.groupValues?.color ?? colorPresets[0]}
                onSelectColor={(nextColor) => {
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
              />
            </div>
          </div>
        ) : null}

        <div className="tag-action-modal-actions">
          {dialog.actions.map((action) => (
            <button
              key={`tag-action-${action.id}`}
              data-tag-action={action.id}
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
