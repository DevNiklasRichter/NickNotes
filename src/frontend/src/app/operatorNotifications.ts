import { useCallback, useEffect, useRef, useState } from 'react'
import type { OperatorNotification } from './AppShared'

type AppOperatorNotification = Pick<OperatorNotification, 'id' | 'message' | 'severity'> & {
  autoClearMs: number | null
}

const OPERATOR_NOTIFICATION_AUTO_CLEAR_MS: Record<OperatorNotification['severity'], number | null> = {
  info: 7000,
  warn: 9000,
  error: null,
  critical: null,
}

export function useOperatorNotifications() {
  const [operatorNotifications, setOperatorNotifications] = useState<AppOperatorNotification[]>([])
  const operatorNotificationIdRef = useRef(1)
  const operatorNotificationTimeoutsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  useEffect(() => {
    const operatorNotificationTimeouts = operatorNotificationTimeoutsRef.current
    return () => {
      operatorNotificationTimeouts.forEach((timeout) => window.clearTimeout(timeout))
      operatorNotificationTimeouts.clear()
    }
  }, [])

  const clearOperatorNotification = useCallback((id: number) => {
    const timeout = operatorNotificationTimeoutsRef.current.get(id)
    if (timeout) {
      window.clearTimeout(timeout)
      operatorNotificationTimeoutsRef.current.delete(id)
    }
    setOperatorNotifications((current) => current.filter((entry) => entry.id !== id))
  }, [])

  const clearOperatorNotificationsBySeverity = useCallback((severities?: Array<OperatorNotification['severity']>) => {
    if (!severities || severities.length === 0) {
      setOperatorNotifications([])
      operatorNotificationTimeoutsRef.current.forEach((timeout) => window.clearTimeout(timeout))
      operatorNotificationTimeoutsRef.current.clear()
      return
    }

    const severitySet = new Set(severities)
    setOperatorNotifications((current) =>
      current.filter((entry) => {
        if (!severitySet.has(entry.severity)) {
          return true
        }

        const timeout = operatorNotificationTimeoutsRef.current.get(entry.id)
        if (timeout) {
          window.clearTimeout(timeout)
          operatorNotificationTimeoutsRef.current.delete(entry.id)
        }
        return false
      })
    )
  }, [])

  const pushOperatorNotification = useCallback((
    message: string,
    severity: OperatorNotification['severity'],
    replaceSeverities?: Array<OperatorNotification['severity']>
  ) => {
    const normalized = message.trim()
    if (!normalized) {
      return
    }

    const autoClearMs = OPERATOR_NOTIFICATION_AUTO_CLEAR_MS[severity]
    const id = operatorNotificationIdRef.current
    operatorNotificationIdRef.current += 1

    const replaceSeveritySet = replaceSeverities?.length ? new Set(replaceSeverities) : null
    setOperatorNotifications((current) => {
      const retained = replaceSeveritySet
        ? current.filter((entry) => {
            if (!replaceSeveritySet.has(entry.severity)) {
              return true
            }

            const timeout = operatorNotificationTimeoutsRef.current.get(entry.id)
            if (timeout) {
              window.clearTimeout(timeout)
              operatorNotificationTimeoutsRef.current.delete(entry.id)
            }
            return false
          })
        : current

      // Repeated polling errors stay one actionable notice, not an unbounded log.
      if (retained.some(entry => entry.message === normalized && entry.severity === severity)) return retained
      return [...retained, { id, message: normalized, severity, autoClearMs }]
    })

    if (typeof autoClearMs === 'number') {
      const timeout = window.setTimeout(() => {
        clearOperatorNotification(id)
      }, autoClearMs)
      operatorNotificationTimeoutsRef.current.set(id, timeout)
    }
  }, [clearOperatorNotification])

  const setMessage = useCallback((message: string) => {
    const normalized = String(message ?? '').trim()
    if (!normalized) {
      clearOperatorNotificationsBySeverity(['info', 'warn'])
      return
    }
    pushOperatorNotification(normalized, 'info', ['info', 'warn'])
  }, [clearOperatorNotificationsBySeverity, pushOperatorNotification])

  const setWarnMessage = useCallback((message: string) => {
    const normalized = String(message ?? '').trim()
    if (!normalized) {
      clearOperatorNotificationsBySeverity(['warn'])
      return
    }
    pushOperatorNotification(normalized, 'warn', ['info', 'warn'])
  }, [clearOperatorNotificationsBySeverity, pushOperatorNotification])

  const setError = useCallback((message: string) => {
    const normalized = String(message ?? '').trim()
    if (!normalized) {
      return
    }
    pushOperatorNotification(normalized, 'error')
  }, [pushOperatorNotification])

  const setCriticalMessage = useCallback((message: string) => {
    const normalized = String(message ?? '').trim()
    if (!normalized) {
      return
    }
    pushOperatorNotification(normalized, 'critical')
  }, [pushOperatorNotification])

  const latestOperatorNotification = operatorNotifications[operatorNotifications.length - 1] ?? null

  return {
    latestOperatorNotification,
    operatorNotifications,
    clearOperatorNotification,
    setMessage,
    setWarnMessage,
    setError,
    setCriticalMessage,
  }
}
