import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Metadata } from './types'

// Holds the in-progress metadata for the next measurement so it survives
// when the user navigates from Measure -> Settings -> Measure. Cleared
// after a measurement is saved (step 7 onwards).

const DEFAULT_METADATA: Metadata = {
  site: '',
  room: '',
  position: '',
  notes: '',
  impulseSource: 'clapper',
}

interface Ctx {
  metadata: Metadata
  setMetadata: (next: Metadata) => void
  reset: () => void
}

const DraftContext = createContext<Ctx | null>(null)

export function MeasurementDraftProvider({ children }: { children: ReactNode }) {
  const [metadata, setMetadataState] = useState<Metadata>(DEFAULT_METADATA)
  const setMetadata = useCallback((next: Metadata) => setMetadataState(next), [])
  const reset = useCallback(() => setMetadataState(DEFAULT_METADATA), [])
  return (
    <DraftContext.Provider value={{ metadata, setMetadata, reset }}>
      {children}
    </DraftContext.Provider>
  )
}

export function useMeasurementDraft(): Ctx {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error('useMeasurementDraft must be used inside <MeasurementDraftProvider>')
  return ctx
}
