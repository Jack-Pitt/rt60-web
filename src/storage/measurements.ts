// Local storage for saved RT60 measurements.
//
// Backed by IndexedDB via the `idb` wrapper. Schema:
//   db = "rt60-web", version 1
//   store = "measurements"
//     keyPath: "id"   (string, generated client-side from timestamp)
//     index "by-timestamp": ms-since-epoch, descending order in lists
//
// Each saved record contains the raw analysis result (including per-band
// decay curves) so the user can re-open it later and re-export to CSV/JSON
// without needing to re-record.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { AnalysisResult } from '../dsp/analyze'
import type { Metadata } from '../measurement/types'

export interface SavedMeasurement {
  /** Unique id, derived from creation timestamp + a small random suffix
   *  so two measurements created in the same millisecond don't collide. */
  id: string
  /** ms since epoch, used both as the index key and for display. */
  timestamp: number
  metadata: Metadata
  result: AnalysisResult
}

interface RT60Schema extends DBSchema {
  measurements: {
    key: string
    value: SavedMeasurement
    indexes: { 'by-timestamp': number }
  }
}

const DB_NAME = 'rt60-web'
const DB_VERSION = 1
const STORE = 'measurements'

let dbPromise: Promise<IDBPDatabase<RT60Schema>> | null = null

function getDb(): Promise<IDBPDatabase<RT60Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<RT60Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('by-timestamp', 'timestamp')
      },
    })
  }
  return dbPromise
}

/** Save a measurement and return its generated id. */
export async function saveMeasurement(
  metadata: Metadata,
  result: AnalysisResult,
): Promise<string> {
  const db = await getDb()
  const timestamp = Date.now()
  const id = `${timestamp}-${Math.floor(Math.random() * 36 ** 4).toString(36)}`
  const record: SavedMeasurement = { id, timestamp, metadata, result }
  await db.put(STORE, record)
  return id
}

/** List saved measurements, newest first. */
export async function listMeasurements(): Promise<SavedMeasurement[]> {
  const db = await getDb()
  // openCursor with 'prev' on the by-timestamp index gives us newest first.
  const tx = db.transaction(STORE, 'readonly')
  const index = tx.store.index('by-timestamp')
  const out: SavedMeasurement[] = []
  let cursor = await index.openCursor(null, 'prev')
  while (cursor) {
    out.push(cursor.value)
    cursor = await cursor.continue()
  }
  await tx.done
  return out
}

/** Fetch a single measurement by id. */
export async function getMeasurement(id: string): Promise<SavedMeasurement | undefined> {
  const db = await getDb()
  return db.get(STORE, id)
}

/** Delete a measurement. */
export async function deleteMeasurement(id: string): Promise<void> {
  const db = await getDb()
  await db.delete(STORE, id)
}
