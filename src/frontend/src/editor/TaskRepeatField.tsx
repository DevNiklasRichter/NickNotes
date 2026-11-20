import { useState } from 'react'
import { canonicalRepeat, customOfRepeat, REPEAT_CUSTOM, REPEAT_PRESETS, REPEAT_UNITS, repeatFromCustom } from './taskRepeat'

type TaskRepeatFieldProps = {
  repeat: unknown
  fromCompletion: boolean
  onChange: (repeat: string, fromCompletion: boolean) => void
}

/** "Wiederholung": when the task is done, its next instance is created as a new open task. */
export function TaskRepeatField({ repeat, fromCompletion, onChange }: TaskRepeatFieldProps) {
  const rule = canonicalRepeat(repeat)
  const isPreset = rule !== null && REPEAT_PRESETS.some(([value]) => value === rule)
  const [customOpen, setCustomOpen] = useState(false)
  const showCustom = rule !== null && (customOpen || !isPreset)
  const custom = customOfRepeat(rule ?? '')
  const selectValue = rule === null ? 'invalid' : showCustom ? REPEAT_CUSTOM : rule

  return (
    <>
      <span className="property-key">Wiederholung</span>
      <div className="property-value-stack">
        <div className="property-value-inline">
          <label className="property-picker-badge">
            <select className="property-picker-select property-repeat-select" aria-label="Wiederholung" value={selectValue}
              onChange={(event) => {
                const value = event.target.value
                if (value === REPEAT_CUSTOM) {
                  setCustomOpen(true)
                  onChange(repeatFromCustom(custom), fromCompletion)
                  return
                }
                setCustomOpen(false)
                onChange(value, value ? fromCompletion : false)
              }}>
              {rule === null ? <option value="invalid" disabled>Unbekannt: {String(repeat)}</option> : null}
              {REPEAT_PRESETS.map(([value, label]) => <option key={value || 'none'} value={value}>{label}</option>)}
              <option value={REPEAT_CUSTOM}>Eigener Abstand …</option>
            </select>
          </label>
          {showCustom ? (
            <span className="property-repeat-custom">
              <span>alle</span>
              <input type="number" min={1} max={365} className="property-repeat-interval" aria-label="Abstand" value={custom.interval}
                onChange={(event) => onChange(repeatFromCustom({ ...custom, interval: Number(event.target.value) }), fromCompletion)} />
              <select className="property-picker-select" aria-label="Einheit" value={custom.unit}
                onChange={(event) => onChange(repeatFromCustom({ ...custom, unit: event.target.value }), fromCompletion)}>
                {REPEAT_UNITS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </span>
          ) : null}
        </div>
        {rule ? (
          <label className="property-repeat-from" data-tooltip="Aus: der Rhythmus bleibt an der Fälligkeit (z. B. immer freitags). An: der Abstand zählt ab dem Tag, an dem du die Task erledigst.">
            <input type="checkbox" checked={fromCompletion} onChange={(event) => onChange(rule, event.target.checked)} />
            <span>ab Erledigung zählen</span>
          </label>
        ) : null}
      </div>
    </>
  )
}
