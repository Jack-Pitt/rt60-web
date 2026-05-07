import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { Metadata } from './types'
import type { AnalysisResult } from '../dsp/analyze'

// Holds the in-progress measurement state — metadata fields and (once
// analysis finishes) the unsaved analysis result. Living in a context
// means everything survives navigation between Measure / History /
// Settings until the user explicitly saves or discards.

const DEFAULT_METADATA: Metadata = {
  site: '',
  room: '',
  position: '',
  notes: '',
  impulseSource: 'handclap',
}

interface UnsavedResult {
  metadata: Metadata
  analysis: AnalysisResult
}

interface Ctx {
  metadata: Metadata
  setMetadata: (next: Metadata) => void
  resetMetadata: () => void
  unsaved: UnsavedResult | null
  setUnsaved: (next: UnsavedResult | null) => void
}

const DraftContext = createContext<Ctx | null>(null)

export function MeasurementDraftProvider({ children }: { children: ReactNode }) {
  const [metadata, setMetadataState] = useState<Metadata>(DEFAULT_METADATA)
  const [unsaved, setUnsavedState] = useState<UnsavedResult | null>(null)
  const setMetadata = useCallback((next: Metadata) => setMetadataState(next), [])
  const resetMetadata = useCallback(() => setMetadataState(DEFAULT_METADATA), [])
  const setUnsaved = useCallback((next: UnsavedResult | null) => setUnsavedState(next), [])
  return (
    <DraftContext.Provider value={{ metadata, setMetadata, resetMetadata, unsaved, setUnsaved }}>
      {children}
    </DraftContext.Provider>
  )
}

export function useMeasurementDraft(): Ctx {
  const ctx = useContext(DraftContext)
  if (!ctx) throw new Error('useMeasurementDraft must be used inside <MeasurementDraftProvider>')
  return ctx
}
