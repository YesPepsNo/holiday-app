import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL      = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(
  SUPABASE_URL      || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder'
)

// ── Load full trip state ───────────────────────────────────────────────────────
export async function loadData(tripId) {
  const { data, error } = await supabase
    .from('trip_data')
    .select('payload')
    .eq('trip_id', tripId)
    .single()
  if (error && error.code !== 'PGRST116') throw error
  return data?.payload ?? null
}

// ── Atomic patch save ─────────────────────────────────────────────────────────
// Instead of saving the whole state, we send only what changed.
// The Postgres function merges it safely even with concurrent saves.
export async function saveData(tripId, patch) {
  // Try the safe merge RPC first
  const { error } = await supabase.rpc('merge_trip_data', {
    p_trip_id: tripId,
    p_patch:   patch,
  })
  if (error) {
    console.warn('merge_trip_data RPC failed, falling back to upsert:', error.message)
    // Fallback: load current, merge in JS, save back
    const current = await loadData(tripId) || {}
    const merged  = mergeLocally(current, patch)
    const { error: e2 } = await supabase
      .from('trip_data')
      .upsert({ trip_id: tripId, payload: merged, updated_at: new Date().toISOString() })
    if (e2) throw e2
  }
}

// Local merge fallback — same logic as Postgres function
function mergeLocally(current, patch) {
  const result = { ...current }
  // Scalar fields
  const scalars = ['tripName','tripNameEditedBy','tripNameEditedAt','adminPin']
  scalars.forEach(k => { if (patch[k] !== undefined) result[k] = patch[k] })
  // Array fields — merge by id, patch wins for matching ids
  const arrays = ['people','families','events','entries','receiptLines']
  arrays.forEach(key => {
    if (!patch[key]) return
    const cur = current[key] || []
    const patchArr = patch[key]
    const patchIds = new Set(patchArr.map(i => i.id))
    // Keep current items not in patch, add all patch items
    const kept = cur.filter(i => !patchIds.has(i.id))
    result[key] = [...patchArr, ...kept]
  })
  // Tips object — merge keys
  if (patch.tips) result.tips = { ...(current.tips || {}), ...patch.tips }
  return result
}

// ── Real-time subscription ────────────────────────────────────────────────────
export function subscribeToTrip(tripId, onUpdate) {
  return supabase
    .channel(`trip:${tripId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_data',
        filter: `trip_id=eq.${tripId}` },
      payload => { if (payload.new?.payload) onUpdate(payload.new.payload) }
    )
    .subscribe()
}
