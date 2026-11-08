import {useState, type Dispatch, type SetStateAction} from 'react'
/** Reset a local field only when its source value or document identity changes. */
export function useSyncedDraft<T>(identity: string, source: T): [T, Dispatch<SetStateAction<T>>] {
  const [previous, setPrevious] = useState({identity, source})
  const [draft, setDraft] = useState(source)
  if (previous.identity !== identity || !Object.is(previous.source, source)) {
    setPrevious({identity, source})
    setDraft(source)
  }
  return [draft, setDraft]
}
