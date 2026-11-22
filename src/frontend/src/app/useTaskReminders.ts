import { useEffect, useEffectEvent } from 'react'
import { apiRequest } from './apiClient'
import type { TaskRow } from './AppShared'
import {
  dueReminders,
  overviewDue,
  overviewNotice,
  readReminderMemory,
  rememberOverview,
  rememberShown,
  reminderNotice,
  writeReminderMemory,
  type ReminderItem,
  type ReminderNotice,
} from './taskReminders'

const POLL_MS = 30_000

type TaskRemindersOptions = {
  backendUrl: string
  /** The open NoteBase; '' while none is loaded. Shown reminders are remembered per NoteBase on this device. */
  vaultPath: string
  onShown: (notice: ReminderNotice) => void
  onOpenTask: (item: ReminderItem) => void
  onOpenOverview: () => void
}

function showWindowsNotification(notice: ReminderNotice, onClick: () => void): void {
  try {
    if (typeof Notification === 'undefined' || Notification.permission === 'denied') return
    const show = () => {
      const notification = new Notification(notice.title, { body: notice.body })
      notification.onclick = () => {
        void window.nicknotes?.windowAction?.('show')
        window.focus()
        onClick()
        notification.close()
      }
    }
    if (Notification.permission === 'granted') show()
    else void Notification.requestPermission().then((permission) => { if (permission === 'granted') show() })
  } catch {
    // The in-app message still shows the reminder.
  }
}

/**
 * Task reminders (`remind_at`) and the optional morning overview as Windows notifications, while
 * NickNotes runs (also hidden in the tray). Polls a small index query; what was shown is device-local.
 */
export function useTaskReminders({ backendUrl, vaultPath, onShown, onOpenTask, onOpenOverview }: TaskRemindersOptions): void {
  const tick = useEffectEvent(async (storageKey: string) => {
    const now = new Date()
    let memory = readReminderMemory(storageKey)
    const { items } = await apiRequest<{ items: ReminderItem[] }>(backendUrl, '/tasks/reminders')
    const due = dueReminders(items, memory, now)
    const notice = reminderNotice(due, now)
    if (notice) {
      memory = rememberShown(memory, due, now)
      writeReminderMemory(storageKey, memory)
      onShown(notice)
      showWindowsNotification(notice, () => (notice.item ? onOpenTask(notice.item) : onOpenOverview()))
    }
    const settings = await window.nicknotes?.getDesktopSettings?.().catch(() => null)
    if (settings && overviewDue(settings.dailyOverview, memory, now)) {
      writeReminderMemory(storageKey, rememberOverview(memory, now))
      const { items: tasks } = await apiRequest<{ items: TaskRow[] }>(backendUrl, '/tasks')
      const overview = overviewNotice(tasks, now)
      if (overview) showWindowsNotification(overview, onOpenOverview)
    }
  })

  useEffect(() => {
    if (!vaultPath || !backendUrl) return
    const storageKey = `nicknotes.reminders.v1:${vaultPath}`
    let stopped = false
    const run = () => {
      if (!stopped) void tick(storageKey).catch(() => { /* The next round tries again. */ })
    }
    run()
    const timer = window.setInterval(run, POLL_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [backendUrl, vaultPath])
}
