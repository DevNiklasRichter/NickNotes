import type { SetStateAction } from 'react'
import { apiRequest, type Suggestion, type VaultCounts } from './AppShared'
import type { AppMutationEvent } from './mutationEvents'
import { capturedTasksNote } from '../shared/capturedTasks'

type NoteCaptureContext = {
  getBackendUrl: () => string
  isVaultLoaded: () => boolean
  getCaptureText: () => string
  getIgnoredCaptureTagKeys: () => string[]
  getSelectedTagKeys: () => string[]
  getCapturePreviewSeq: () => number
  setCapturePreviewSeq: (value: number) => void
  getCapturePreviewLastText: () => string
  setCapturePreviewLastText: (value: string) => void
  emitMutation?: (event: AppMutationEvent) => Promise<void> | void
}

type NoteCaptureWriter = {
  setSuggestions: (next: SetStateAction<Suggestion[]>) => void
  setSelectedTagKeys: (next: SetStateAction<string[]>) => void
  setIgnoredCaptureTagKeys: (next: SetStateAction<string[]>) => void
  setCaptureText: (text: string) => void
  setMessage: (message: string) => void
  setError: (error: string) => void
  setCounts: (counts: VaultCounts) => void
}

const CAPTURE_PREVIEW_IDLE_MS = 1200
const CAPTURE_PREVIEW_MIN_CHARS = 3

export class NoteCaptureService {
  private readonly context: NoteCaptureContext
  private readonly writer: NoteCaptureWriter

  constructor(context: NoteCaptureContext, writer: NoteCaptureWriter) {
    this.context = context
    this.writer = writer
  }

  private get backendUrl() {
    return this.context.getBackendUrl()
  }

  previewCapture = async (text: string): Promise<void> => {
    if (!this.context.isVaultLoaded()) {
      this.writer.setSuggestions([])
      this.writer.setSelectedTagKeys([])
      this.context.setCapturePreviewLastText('')
      this.context.setCapturePreviewSeq(0)
      return
    }

    const normalizedText = text.trim()
    const requestSeq = this.context.getCapturePreviewSeq() + 1
    this.context.setCapturePreviewSeq(requestSeq)

    if (normalizedText.length < CAPTURE_PREVIEW_MIN_CHARS) {
      this.writer.setSuggestions([])
      this.writer.setSelectedTagKeys([])
      this.context.setCapturePreviewLastText('')
      return
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, CAPTURE_PREVIEW_IDLE_MS)
    })
    if (requestSeq !== this.context.getCapturePreviewSeq()) {
      return
    }

    try {
      const response = await apiRequest<{ suggestions: Suggestion[] }>(
        this.backendUrl,
        '/capture/preview',
        {
          method: 'POST',
          body: JSON.stringify({ text: normalizedText }),
        }
      )
      if (requestSeq !== this.context.getCapturePreviewSeq()) {
        return
      }

      this.context.setCapturePreviewLastText(normalizedText)
      const ignoredKeys = new Set(this.context.getIgnoredCaptureTagKeys())
      const visibleSuggestions = response.suggestions.filter((item) => !ignoredKeys.has(item.key))
      const selectedTagKeys = this.context
        .getSelectedTagKeys()
        .filter((key) => visibleSuggestions.some((item) => item.key === key))

      this.writer.setSuggestions(visibleSuggestions)
      this.writer.setSelectedTagKeys(selectedTagKeys)
    } catch {
      // Best effort preview: keep previous suggestions.
    }
  }

  toggleCaptureTag = (tagKey: string): void => {
    this.writer.setSuggestions((items) => items.filter((item) => item.key !== tagKey))
    this.writer.setSelectedTagKeys((keys) => keys.filter((key) => key !== tagKey))
  }

  rejectCaptureTag = (tagKey: string): void => {
    this.writer.setIgnoredCaptureTagKeys((keys) => (keys.includes(tagKey) ? keys : [...keys, tagKey]))
    this.writer.setSuggestions((items) => items.filter((item) => item.key !== tagKey))
    this.writer.setSelectedTagKeys((keys) => keys.filter((key) => key !== tagKey))
  }

  saveCapture = async (rawText?: string): Promise<void> => {
    const text = (rawText ?? this.context.getCaptureText()).trim()
    if (!text) {
      return
    }

    try {
      const response = await apiRequest<{ counts: VaultCounts; date: string; tasks?: Array<{ taskId: string; dueDate: string }> }>(
        this.backendUrl,
        '/capture/save',
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            selectedTagKeys: this.context.getSelectedTagKeys(),
          }),
        }
      )

      this.writer.setCounts(response.counts)
      this.writer.setCaptureText('')
      this.writer.setSuggestions([])
      this.writer.setSelectedTagKeys([])
      this.writer.setIgnoredCaptureTagKeys([])
      this.writer.setMessage(`Schnellerfassung in der Tagesnotiz ${response.date} gespeichert.${capturedTasksNote(response.tasks ?? [])}`)
      await this.context.emitMutation?.({
        kind: 'capture-saved',
        refresh: {
          search: true,
          todos: true,
          tasks: (response.tasks ?? []).length > 0,
          review: true,
          noteGroups: true,
          explorerSidebar: true,
        },
      })
    } catch (caught) {
      this.writer.setError(String(caught))
    }
  }
}
