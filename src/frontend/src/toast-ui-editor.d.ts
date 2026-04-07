declare module '@toast-ui/editor' {
  export type EditorType = 'markdown' | 'wysiwyg'

  export interface EventMap {
    change?: (editorType: EditorType) => void
  }

  export interface EditorOptions {
    el: HTMLElement
    height?: string
    minHeight?: string
    initialValue?: string
    initialEditType?: EditorType
    hideModeSwitch?: boolean
    usageStatistics?: boolean
    autofocus?: boolean
    theme?: string
    toolbarItems?: string[][]
    events?: EventMap
  }

  export default class Editor {
    constructor(options: EditorOptions)
    destroy(): void
    getMarkdown(): string
    setMarkdown(markdown: string, cursorToEnd?: boolean): void
    insertText(text: string): void
    getSelectedText(): string
    focus(): void
  }
}
