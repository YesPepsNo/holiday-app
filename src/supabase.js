import { createClient } from '@supabase/supabase-js'

// ─── Replace these two values after creating your Supabase project ───────────
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY
// ─────────────────────────────────────────────────────────────────────────────

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    '⚠ Missing Supabase credentials.\n' +
    'Copy .env.example → .env and fill in your project URL and anon key.\n' +
    'See README.md for setup instructions.'
  )
}

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_ANON_KEY || 'placeholder'
)

// ─── Thin data-access helpers ─────────────────────────────────────────────────

export async function loadAppData(tripId) {
  const { data, error } = await supabase
    .from('trip_data')
    .select('payload')
    .eq('trip_id', tripId)
    .single()
  if (error && error.code !== 'PGRST116') throw error   // PGRST116 = no rows
  return data?.payload ?? null
}

export async function saveAppData(tripId, payload) {
  const { error } = await supabase
    .from('trip_data')
    .upsert({ trip_id: tripId, payload, updated_at: new Date().toISOString() })
  if (error) throw error
}

// ─── Real-time subscription ───────────────────────────────────────────────────
export function subscribeToTrip(tripId, onUpdate) {
  return supabase
    .channel(`trip:${tripId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trip_data', filter: `trip_id=eq.${tripId}` },
      (payload) => { if (payload.new?.payload) onUpdate(payload.new.payload) }
    )
    .subscribe()
}
