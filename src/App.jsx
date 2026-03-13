import { useState, useEffect, useCallback, useRef } from 'react'
import { loadAppData, saveAppData, subscribeToTrip } from './supabase.js'

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg: '#0f0f0f', surface: '#1a1a1a', card: '#222', border: '#2e2e2e',
  borderLight: '#383838', accent: '#e8c547', text: '#f0ede6',
  muted: '#888', faint: '#444',
  green: '#4caf6e', red: '#e05252', orange: '#e87d3e', blue: '#5b9bd5',
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n) => `€${(+n || 0).toFixed(2)}`
const uid   = () => Math.random().toString(36).slice(2, 10)
const today = () => new Date().toISOString().slice(0, 10)

const TRIP_ID_KEY = 'holiday-trip-id'
const USER_KEY    = 'holiday-current-user'

const INIT_DATA = {
  tripName:     'Holiday 2025',
  people:       [],   // { id, name, familyId }
  families:     [],   // { id, name }
  events:       [],   // { id, type, name, date, payerIds, total?, beneficiaries?, items? }
  entries:      [],   // { id, eventId, personId, items:[{id,name,price}] }
  receiptLines: [],   // { id, eventId, name, price, matchedPersonId, status }
  tips:         {},   // eventId → { amount, includedInReceipt }
}

// ── Tiny UI primitives ────────────────────────────────────────────────────────
function Btn({ children, onClick, variant = 'default', disabled, full, small, style: s = {} }) {
  const base = { borderRadius: 8, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', transition: 'opacity .15s', opacity: disabled ? .45 : 1, border: '1px solid', width: full ? '100%' : 'auto', padding: small ? '5px 12px' : '9px 18px', fontSize: small ? 12 : 13, fontWeight: 500 }
  const v = { default: { background: C.card, borderColor: C.border, color: C.text }, primary: { background: C.accent, borderColor: C.accent, color: '#0f0f0f' }, ghost: { background: 'transparent', borderColor: C.border, color: C.muted }, danger: { background: 'transparent', borderColor: C.red + '55', color: C.red }, success: { background: C.green + '22', borderColor: C.green + '55', color: C.green } }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...v[variant], ...s }}>{children}</button>
}

function Field({ label, children }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
    {label && <label style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>}
    {children}
  </div>
}

const inputStyle = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, color: C.text, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }

function Input({ label, value, onChange, placeholder, type = 'text', style: s = {} }) {
  return <Field label={label}><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={{ ...inputStyle, ...s }} /></Field>
}

function Sel({ label, value, onChange, options }) {
  return <Field label={label}>
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, color: value ? C.text : C.muted }}>
      <option value=''>Select…</option>
      {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  </Field>
}

function Card({ children, style: s = {}, highlight }) {
  return <div style={{ background: C.card, border: `1px solid ${highlight ? C.accent + '44' : C.border}`, borderRadius: 12, padding: '16px 20px', ...s }}>{children}</div>
}

function SecTitle({ children }) {
  return <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12, fontWeight: 600 }}>{children}</div>
}

function Pill({ children, color = C.accent, small }) {
  return <span style={{ display: 'inline-block', padding: small ? '2px 8px' : '3px 10px', borderRadius: 99, fontSize: small ? 11 : 12, fontWeight: 600, background: color + '28', color, border: `1px solid ${color}40` }}>{children}</span>
}

function Toast({ msg }) {
  if (!msg) return null
  const ok = msg.startsWith('✓')
  return <div style={{ fontSize: 13, color: ok ? C.green : C.red, padding: '8px 12px', background: ok ? C.green + '20' : C.red + '20', borderRadius: 8, marginTop: 4 }}>{msg}</div>
}

function ChipRow({ people, selected, onToggle, color = C.accent }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
    {people.map(p => {
      const on = selected.includes(p.id)
      return <button key={p.id} onClick={() => onToggle(p.id)} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: on ? color + '28' : C.surface, color: on ? color : C.muted, border: `1px solid ${on ? color : C.border}`, fontWeight: on ? 600 : 400 }}>{p.name}</button>
    })}
  </div>
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function SetupView({ data, update }) {
  const [newPerson, setNewPerson] = useState('')
  const [newFam,    setNewFam]    = useState('')
  const [tripName,  setTripName]  = useState(data.tripName)
  const [msg,       setMsg]       = useState('')

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addPerson = () => {
    const n = newPerson.trim(); if (!n) return
    update(d => ({ ...d, people: [...d.people, { id: uid(), name: n, familyId: '' }] }))
    setNewPerson(''); flash('✓ Added')
  }
  const addFamily = () => {
    const n = newFam.trim(); if (!n) return
    update(d => ({ ...d, families: [...d.families, { id: uid(), name: n }] }))
    setNewFam(''); flash('✓ Family group added')
  }
  const removePerson = (id) => {
    if (!confirm('Remove this person?')) return
    update(d => ({ ...d, people: d.people.filter(p => p.id !== id) }))
  }
  const removeFamily = (id) => {
    if (!confirm('Remove family group? Members will become ungrouped.')) return
    update(d => ({ ...d, families: d.families.filter(f => f.id !== id), people: d.people.map(p => p.familyId === id ? { ...p, familyId: '' } : p) }))
  }
  const assignFamily = (personId, familyId) => update(d => ({ ...d, people: d.people.map(p => p.id === personId ? { ...p, familyId } : p) }))
  const saveName = () => { update(d => ({ ...d, tripName })); flash('✓ Saved') }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Toast msg={msg} />

      <Card>
        <SecTitle>Trip name</SecTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={tripName} onChange={setTripName} placeholder='e.g. Lake Garda 2025' style={{ flex: 1 }} />
          <Btn onClick={saveName} variant='primary'>Save</Btn>
        </div>
      </Card>

      <Card>
        <SecTitle>Family groups <span style={{ color: C.faint, fontWeight: 400 }}>— optional, helps settle up</span></SecTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Input value={newFam} onChange={setNewFam} placeholder='e.g. The Smiths' style={{ flex: 1 }} />
          <Btn onClick={addFamily} variant='primary'>Add</Btn>
        </div>
        {data.families.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>No groups yet — groups let families pay together at the end.</div>}
        {data.families.map(f => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 14 }}>{f.name}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.faint }}>{data.people.filter(p => p.familyId === f.id).length} members</span>
              <Btn onClick={() => removeFamily(f.id)} variant='danger' small>Remove</Btn>
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <SecTitle>People ({data.people.length})</SecTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Input value={newPerson} onChange={setNewPerson} placeholder='Add a name…' style={{ flex: 1 }} />
          <Btn onClick={addPerson} variant='primary'>Add</Btn>
        </div>
        {data.people.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>Add everyone in your group here.</div>}
        {data.people.map(p => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ flex: 1, fontSize: 14 }}>{p.name}</span>
            {data.families.length > 0 && (
              <select value={p.familyId || ''} onChange={e => assignFamily(p.id, e.target.value)}
                style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, color: p.familyId ? C.text : C.muted, fontFamily: 'inherit' }}>
                <option value=''>No family</option>
                {data.families.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            )}
            <Btn onClick={() => removePerson(p.id)} variant='danger' small>×</Btn>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── Add Expense ───────────────────────────────────────────────────────────────
function AddExpenseView({ data, update, currentUser }) {
  const [tab, setTab]             = useState('dinner')
  const [msg, setMsg]             = useState('')

  // ---- Dinner / new event ----
  const [evtName,       setEvtName]       = useState('')
  const [evtDate,       setEvtDate]       = useState(today())
  const [payerIds,      setPayerIds]      = useState([])
  const [tipAmt,        setTipAmt]        = useState('')
  const [tipInReceipt,  setTipInReceipt]  = useState(false)
  const [forPerson,     setForPerson]     = useState(currentUser?.id || '')
  const [dItems,        setDItems]        = useState([{ id: uid(), name: '', price: '' }])

  // ---- My order (add to existing) ----
  const [addToEvt,  setAddToEvt]  = useState('')
  const [forPerson2, setForPerson2] = useState(currentUser?.id || '')
  const [mItems,    setMItems]    = useState([{ id: uid(), name: '', price: '' }])

  // ---- Grocery ----
  const [gDesc,  setGDesc]  = useState('')
  const [gDate,  setGDate]  = useState(today())
  const [gPayer, setGPayer] = useState('')
  const [gTotal, setGTotal] = useState('')
  const [gBens,  setGBens]  = useState([])

  useEffect(() => { if (currentUser) { setForPerson(currentUser.id); setForPerson2(currentUser.id) } }, [currentUser])

  const flash = (m) => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  const updateItem = (list, setList, idx, field, val) =>
    setList(list.map((it, i) => i === idx ? { ...it, [field]: val } : it))
  const removeItemAt = (list, setList, idx) => setList(list.filter((_, i) => i !== idx))
  const addItemRow = (list, setList) => setList([...list, { id: uid(), name: '', price: '' }])

  function ItemRows({ items, setItems }) {
    return <>
      {items.map((item, idx) => (
        <div key={item.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-end' }}>
          <div style={{ flex: 3 }}><Input value={item.name} onChange={v => updateItem(items, setItems, idx, 'name', v)} placeholder='Dish / drink' /></div>
          <div style={{ flex: 1 }}><Input value={item.price} onChange={v => updateItem(items, setItems, idx, 'price', v)} placeholder='€' type='number' /></div>
          <Btn onClick={() => removeItemAt(items, setItems, idx)} variant='danger' small>×</Btn>
        </div>
      ))}
      <Btn onClick={() => addItemRow(items, setItems)} variant='ghost' small>+ item</Btn>
    </>
  }

  const saveDinner = () => {
    if (!evtName || !evtDate || !payerIds.length || !forPerson) return flash('Fill in event name, date, payer(s), and select a person.')
    const valid = dItems.filter(i => i.name.trim() && i.price !== '')
    if (!valid.length) return flash('Add at least one item with name and price.')
    const eventId = uid()
    update(d => ({
      ...d,
      events:  [...d.events,  { id: eventId, type: 'dinner', name: evtName, date: evtDate, payerIds }],
      entries: [...d.entries, { id: uid(), eventId, personId: forPerson, items: valid.map(i => ({ ...i, price: parseFloat(i.price) || 0 })) }],
      tips:    tipAmt ? { ...d.tips, [eventId]: { amount: parseFloat(tipAmt) || 0, includedInReceipt: tipInReceipt } } : d.tips,
    }))
    setEvtName(''); setPayerIds([]); setTipAmt(''); setDItems([{ id: uid(), name: '', price: '' }])
    flash('✓ Dinner saved!')
  }

  const saveMyOrder = () => {
    if (!addToEvt || !forPerson2) return flash('Select an event and person.')
    const valid = mItems.filter(i => i.name.trim() && i.price !== '')
    if (!valid.length) return flash('Add at least one item.')
    const parsedItems = valid.map(i => ({ ...i, price: parseFloat(i.price) || 0 }))
    update(d => {
      const existing = d.entries.find(e => e.eventId === addToEvt && e.personId === forPerson2)
      if (existing) {
        return { ...d, entries: d.entries.map(e => e.id === existing.id ? { ...e, items: [...e.items, ...parsedItems] } : e) }
      }
      return { ...d, entries: [...d.entries, { id: uid(), eventId: addToEvt, personId: forPerson2, items: parsedItems }] }
    })
    setMItems([{ id: uid(), name: '', price: '' }])
    flash('✓ Order saved!')
  }

  const saveGrocery = () => {
    if (!gDesc || !gDate || !gPayer || !gTotal || !gBens.length) return flash('Fill in all fields and select who benefits.')
    update(d => ({ ...d, events: [...d.events, { id: uid(), type: 'grocery', name: gDesc, date: gDate, payerIds: [gPayer], total: parseFloat(gTotal) || 0, beneficiaries: gBens }] }))
    setGDesc(''); setGTotal(''); setGBens([])
    flash('✓ Grocery run saved!')
  }

  const TabBtn = ({ id, label }) => (
    <button onClick={() => setTab(id)} style={{ padding: '7px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit', background: tab === id ? C.accent : C.card, color: tab === id ? '#0f0f0f' : C.muted, border: `1px solid ${tab === id ? C.accent : C.border}` }}>{label}</button>
  )

  const dinnerEvents = data.events.filter(e => e.type === 'dinner')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <TabBtn id='dinner'   label='New dinner event' />
        <TabBtn id='myorder'  label='Add my order' />
        <TabBtn id='grocery'  label='Groceries' />
      </div>

      <Toast msg={msg} />

      {tab === 'dinner' && (
        <>
          <Card>
            <SecTitle>Event details</SecTitle>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '2 1 180px' }}><Input label='Restaurant / event' value={evtName} onChange={setEvtName} placeholder='e.g. La Trattoria' /></div>
              <div style={{ flex: '1 1 130px' }}><Input label='Date' value={evtDate} onChange={setEvtDate} type='date' /></div>
            </div>
          </Card>
          <Card>
            <SecTitle>Who paid tonight?</SecTitle>
            <ChipRow people={data.people} selected={payerIds} onToggle={id => setPayerIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} />
          </Card>
          <Card>
            <SecTitle>Tip</SecTitle>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: '0 0 130px' }}><Input label='Tip amount (€)' value={tipAmt} onChange={setTipAmt} type='number' placeholder='0.00' /></div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: C.muted, marginTop: 18, cursor: 'pointer' }}>
                <input type='checkbox' checked={tipInReceipt} onChange={e => setTipInReceipt(e.target.checked)} />
                Already included in receipt total
              </label>
            </div>
          </Card>
          <Card>
            <SecTitle>Whose order are you recording?</SecTitle>
            <Sel value={forPerson} onChange={setForPerson} options={data.people.map(p => ({ v: p.id, l: p.name }))} />
            <div style={{ marginTop: 12 }}><ItemRows items={dItems} setItems={setDItems} /></div>
          </Card>
          <Btn onClick={saveDinner} variant='primary' full>Save dinner event</Btn>
        </>
      )}

      {tab === 'myorder' && (
        <>
          <Card>
            <SecTitle>Add order to existing dinner</SecTitle>
            {dinnerEvents.length === 0
              ? <div style={{ fontSize: 13, color: C.faint }}>No dinner events yet — create one first.</div>
              : <>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                  <div style={{ flex: '2 1 200px' }}><Sel label='Event' value={addToEvt} onChange={setAddToEvt} options={dinnerEvents.map(e => ({ v: e.id, l: `${e.name} (${e.date})` }))} /></div>
                  <div style={{ flex: '1 1 160px' }}><Sel label='Who is this for?' value={forPerson2} onChange={setForPerson2} options={data.people.map(p => ({ v: p.id, l: p.name }))} /></div>
                </div>
                <ItemRows items={mItems} setItems={setMItems} />
              </>
            }
          </Card>
          <Btn onClick={saveMyOrder} variant='primary' full disabled={dinnerEvents.length === 0}>Save order</Btn>
        </>
      )}

      {tab === 'grocery' && (
        <>
          <Card>
            <SecTitle>Grocery run</SecTitle>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
              <div style={{ flex: '2 1 200px' }}><Input label='Description' value={gDesc} onChange={setGDesc} placeholder='e.g. Morning supermarket run' /></div>
              <div style={{ flex: '1 1 130px' }}><Input label='Date' value={gDate} onChange={setGDate} type='date' /></div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: '1 1 160px' }}><Sel label='Who paid?' value={gPayer} onChange={setGPayer} options={data.people.map(p => ({ v: p.id, l: p.name }))} /></div>
              <div style={{ flex: '1 1 110px' }}><Input label='Total (€)' value={gTotal} onChange={setGTotal} type='number' placeholder='0.00' /></div>
            </div>
          </Card>
          <Card>
            <SecTitle>Split between</SecTitle>
            <ChipRow people={data.people} selected={gBens} onToggle={id => setGBens(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])} color={C.green} />
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <Btn onClick={() => setGBens(data.people.map(p => p.id))} variant='ghost' small>All</Btn>
              <Btn onClick={() => setGBens([])} variant='ghost' small>Clear</Btn>
            </div>
          </Card>
          <Btn onClick={saveGrocery} variant='primary' full>Save grocery run</Btn>
        </>
      )}
    </div>
  )
}

// ── Receipt Scan ──────────────────────────────────────────────────────────────
function ReceiptView({ data, update }) {
  const [eventId,  setEventId]  = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg,  setScanMsg]  = useState('')

  const personName = id => data.people.find(p => p.id === id)?.name || '?'

  const dinnerEvents  = data.events.filter(e => e.type === 'dinner')
  const eventEntries  = data.entries.filter(e => e.eventId === eventId)
  const eventLines    = data.receiptLines.filter(l => l.eventId === eventId)

  const allEntryItems = eventEntries.flatMap(en =>
    en.items.map(it => ({ ...it, personId: en.personId }))
  )

  async function handleFile(file) {
    if (!eventId) { setScanMsg('Select an event first.'); return }
    setScanning(true); setScanMsg('')
    const b64 = await new Promise((ok, err) => {
      const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = err; r.readAsDataURL(file)
    })
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 1500,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: file.type || 'image/jpeg', data: b64 } },
            { type: 'text', text: 'Extract every individual line item from this restaurant receipt. Return ONLY a valid JSON array, no markdown, no explanation. Each element must have "name" (string) and "price" (number). Ignore section totals, grand totals, taxes, or service charge lines unless they are individual items. If the receipt is unreadable, return []. Example output: [{"name":"Tagliatelle al ragù","price":14.50},{"name":"Glass of house red","price":6.00}]' }
          ]}]
        })
      })
      const d   = await resp.json()
      const txt = (d.content || []).map(c => c.text || '').join('')
      let items = []
      try { items = JSON.parse(txt.replace(/```[a-z]*\n?|```/g, '').trim()) } catch {}
      if (!items.length) { setScanMsg("Couldn't extract items — try a clearer, well-lit photo."); setScanning(false); return }

      const newLines = items.map(ri => {
        const nl = ri.name.toLowerCase()
        const match = allEntryItems.find(ei =>
          ei.name.toLowerCase().split(' ').some(w => w.length > 3 && nl.includes(w)) ||
          Math.abs(ei.price - ri.price) < 0.06
        )
        return { id: uid(), eventId, name: ri.name, price: ri.price, matchedPersonId: match?.personId || null, matchedEntryItemId: match?.id || null, status: match ? 'matched' : 'unmatched' }
      })

      update(d => ({ ...d, receiptLines: [...d.receiptLines.filter(l => l.eventId !== eventId), ...newLines] }))
      const mc = newLines.filter(l => l.status === 'matched').length
      setScanMsg(`✓ ${items.length} items found — ${mc} auto-matched, ${items.length - mc} need assigning.`)
    } catch { setScanMsg('Network error reading receipt — check your connection.') }
    setScanning(false)
  }

  const reassign = (lineId, personId) =>
    update(d => ({ ...d, receiptLines: d.receiptLines.map(l => l.id === lineId ? { ...l, matchedPersonId: personId || null, status: personId ? 'assigned' : 'unmatched' } : l) }))

  const matched   = eventLines.filter(l => l.status !== 'unmatched')
  const unmatched = eventLines.filter(l => l.status === 'unmatched')
  const receiptTotal = eventLines.reduce((s, l) => s + l.price, 0)
  const loggedTotal  = allEntryItems.reduce((s, i) => s + i.price, 0)
  const diff         = Math.abs(receiptTotal - loggedTotal)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Card>
        <SecTitle>Select dinner event</SecTitle>
        <Sel value={eventId} onChange={setEventId} options={dinnerEvents.map(e => ({ v: e.id, l: `${e.name} — ${e.date}` }))} />
      </Card>

      {eventId && <>
        <Card>
          <SecTitle>Upload receipt photo</SecTitle>
          <label
            style={{ display: 'block', border: `2px dashed ${C.border}`, borderRadius: 10, padding: '2rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color .2s' }}
            onMouseOver={e => e.currentTarget.style.borderColor = C.accent}
            onMouseOut={e  => e.currentTarget.style.borderColor = C.border}
            onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.accent }}
            onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = C.border; handleFile(e.dataTransfer.files[0]) }}
          >
            <div style={{ fontSize: 32, marginBottom: 6 }}>📄</div>
            <div style={{ fontSize: 14, color: C.muted }}>Click or drag & drop receipt photo</div>
            <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>AI reads items, then cross-references with what people logged</div>
            <input type='file' accept='image/*' style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
          </label>
          {scanning && (
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 12, fontSize: 13, color: C.muted }}>
              <div style={{ width: 14, height: 14, border: `2px solid ${C.border}`, borderTopColor: C.accent, borderRadius: '50%', animation: 'spin .7s linear infinite' }} />
              Reading receipt with AI…
            </div>
          )}
          {scanMsg && <div style={{ marginTop: 10, fontSize: 13, color: scanMsg.startsWith('✓') ? C.green : C.red }}>{scanMsg}</div>}
        </Card>

        {eventLines.length > 0 && <>
          {/* Totals comparison */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {[
              { label: 'Receipt total', val: fmt(receiptTotal), color: C.accent },
              { label: 'Logged total',  val: fmt(loggedTotal),  color: C.text },
              { label: 'Difference',    val: fmt(diff) + (diff < 0.10 ? ' ✓' : ' ⚠'), color: diff < 0.10 ? C.green : C.red },
            ].map(s => (
              <Card key={s.label} style={{ flex: '1 1 110px' }}>
                <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.05em' }}>{s.label}</div>
                <div style={{ fontSize: 20, fontWeight: 600, color: s.color }}>{s.val}</div>
              </Card>
            ))}
          </div>

          {/* Unmatched — TO BE ASSIGNED */}
          {unmatched.length > 0 && (
            <Card highlight>
              <SecTitle>⚠ To be assigned ({unmatched.length})</SecTitle>
              {unmatched.map(line => (
                <div key={line.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8, padding: '10px 12px', background: C.orange + '15', borderRadius: 8, border: `1px solid ${C.orange}33` }}>
                  <span style={{ flex: 2, fontSize: 14 }}>{line.name}</span>
                  <span style={{ fontSize: 13, color: C.accent, fontWeight: 600 }}>{fmt(line.price)}</span>
                  <select value={line.matchedPersonId || ''} onChange={e => reassign(line.id, e.target.value)}
                    style={{ flex: 1, background: C.surface, border: `1px solid ${C.orange}55`, borderRadius: 6, padding: '6px 8px', fontSize: 13, color: line.matchedPersonId ? C.text : C.muted, fontFamily: 'inherit' }}>
                    <option value=''>Assign to…</option>
                    {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              ))}
            </Card>
          )}

          {/* Matched */}
          <Card>
            <SecTitle>✓ Matched ({matched.length})</SecTitle>
            {matched.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>None yet.</div>}
            {matched.map(line => {
              const person = data.people.find(p => p.id === line.matchedPersonId)
              return (
                <div key={line.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6, padding: '8px 12px', background: C.green + '10', borderRadius: 8, border: `1px solid ${C.green}22` }}>
                  <span style={{ flex: 2, fontSize: 13 }}>{line.name}</span>
                  <span style={{ fontSize: 12, color: C.muted }}>{fmt(line.price)}</span>
                  <span style={{ fontSize: 12, color: C.green, flex: 1 }}>{person?.name || '—'}</span>
                  <select value={line.matchedPersonId || ''} onChange={e => reassign(line.id, e.target.value)}
                    style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 6px', fontSize: 11, color: C.muted, fontFamily: 'inherit' }}>
                    <option value=''>Reassign…</option>
                    {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )
            })}
          </Card>
        </>}

        {eventLines.length === 0 && (
          <div style={{ padding: '3rem', textAlign: 'center', color: C.faint, fontSize: 13, border: `1px solid ${C.border}`, borderRadius: 12 }}>
            Upload a receipt photo to start cross-referencing.
          </div>
        )}
      </>}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

// ── Events log ────────────────────────────────────────────────────────────────
function EventsView({ data, update }) {
  const personName = id => data.people.find(p => p.id === id)?.name || '?'
  const sorted = [...data.events].sort((a, b) => b.date.localeCompare(a.date))

  const deleteEvent = id => {
    if (!confirm('Delete this event and all its data?')) return
    update(d => ({ ...d, events: d.events.filter(e => e.id !== id), entries: d.entries.filter(e => e.eventId !== id), receiptLines: d.receiptLines.filter(l => l.eventId !== id) }))
  }

  if (!sorted.length) return <div style={{ padding: '3rem', textAlign: 'center', color: C.faint, fontSize: 14 }}>No events yet.</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {sorted.map(evt => {
        const entries     = data.entries.filter(e => e.eventId === evt.id)
        const lines       = data.receiptLines.filter(l => l.eventId === evt.id)
        const total       = evt.type === 'grocery' ? evt.total : entries.reduce((s, en) => s + en.items.reduce((ss, i) => ss + i.price, 0), 0)
        const tip         = data.tips?.[evt.id]
        const unmatched   = lines.filter(l => l.status === 'unmatched').length
        const hasReceipt  = lines.length > 0

        return (
          <Card key={evt.id}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 4 }}>
                  <Pill color={evt.type === 'grocery' ? C.green : C.accent}>{evt.type === 'grocery' ? 'Groceries' : 'Dinner'}</Pill>
                  <span style={{ fontWeight: 600, fontSize: 15 }}>{evt.name}</span>
                </div>
                <div style={{ fontSize: 12, color: C.muted }}>{evt.date} · paid by {(evt.payerIds || []).map(personName).join(', ')}</div>
                {tip && <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>Tip: {fmt(tip.amount)} {tip.includedInReceipt ? '(in receipt)' : '(cash on top)'}</div>}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 20, fontWeight: 600, color: C.accent }}>{fmt(total)}</div>
                {evt.type === 'dinner' && <div style={{ fontSize: 12, color: C.muted }}>{entries.length} people logged</div>}
              </div>
            </div>

            {evt.type === 'dinner' && entries.length > 0 && (
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, marginBottom: 8 }}>
                {entries.map(en => (
                  <div key={en.id} style={{ marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: C.accent, fontWeight: 500 }}>{personName(en.personId)}: </span>
                    <span style={{ fontSize: 12, color: C.muted }}>{en.items.map(i => `${i.name} ${fmt(i.price)}`).join(' · ')}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              {hasReceipt
                ? unmatched > 0
                  ? <Pill color={C.orange} small>{unmatched} item{unmatched !== 1 ? 's' : ''} unassigned</Pill>
                  : <Pill color={C.green} small>Receipt ✓ reconciled</Pill>
                : evt.type === 'dinner' && <Pill color={C.faint} small>No receipt scanned</Pill>
              }
              <Btn onClick={() => deleteEvent(evt.id)} variant='danger' small style={{ marginLeft: 'auto' }}>Delete</Btn>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ── Settle Up ─────────────────────────────────────────────────────────────────
function SettleView({ data }) {
  const personName = id => data.people.find(p => p.id === id)?.name || '?'
  const famName    = id => data.families.find(f => f.id === id)?.name

  const consumed = {}, paid = {}
  data.people.forEach(p => { consumed[p.id] = 0; paid[p.id] = 0 })

  data.events.forEach(evt => {
    if (evt.type === 'grocery') {
      const share = evt.total / Math.max(evt.beneficiaries?.length || 1, 1)
      ;(evt.beneficiaries || []).forEach(pid => { if (consumed[pid] !== undefined) consumed[pid] += share })
      const payer = evt.payerIds?.[0]
      if (payer && paid[payer] !== undefined) paid[payer] += evt.total
    } else {
      const tip        = data.tips?.[evt.id]
      const tipAmt     = tip?.amount || 0
      const eventEntries = data.entries.filter(e => e.eventId === evt.id)
      const diners     = eventEntries.map(e => e.personId)
      const dinnerTotal = eventEntries.reduce((s, en) => s + en.items.reduce((ss, i) => ss + i.price, 0), 0)

      eventEntries.forEach(en => {
        const sub = en.items.reduce((s, i) => s + i.price, 0)
        if (consumed[en.personId] !== undefined) consumed[en.personId] += sub
      })
      // Tip split equally among diners
      if (diners.length && tipAmt) {
        const perHead = tipAmt / diners.length
        diners.forEach(pid => { if (consumed[pid] !== undefined) consumed[pid] += perHead })
      }
      // Payer(s) paid dinner total + tip
      const payerCount = evt.payerIds?.length || 0
      if (payerCount) {
        const totalOut = dinnerTotal + tipAmt
        evt.payerIds.forEach(pid => { if (paid[pid] !== undefined) paid[pid] += totalOut / payerCount })
      }
    }
  })

  const balance = {}
  data.people.forEach(p => { balance[p.id] = paid[p.id] - consumed[p.id] })

  // Minimise transactions
  const debtors   = data.people.filter(p => balance[p.id] < -0.01).map(p => ({ id: p.id, amt: -balance[p.id] }))
  const creditors = data.people.filter(p => balance[p.id] >  0.01).map(p => ({ id: p.id, amt:  balance[p.id] }))
  const txns = []
  const D = debtors.map(x => ({ ...x })), CR = creditors.map(x => ({ ...x }))
  let di = 0, ci = 0
  while (di < D.length && ci < CR.length) {
    const pay = Math.min(D[di].amt, CR[ci].amt)
    if (pay > 0.01) txns.push({ from: D[di].id, to: CR[ci].id, amt: pay })
    D[di].amt -= pay; CR[ci].amt -= pay
    if (D[di].amt < 0.01) di++
    if (CR[ci].amt < 0.01) ci++
  }

  // Family totals
  const famTotals = data.families.map(f => {
    const members = data.people.filter(p => p.familyId === f.id)
    return { ...f, consumed: members.reduce((s, p) => s + consumed[p.id], 0), paid: members.reduce((s, p) => s + paid[p.id], 0), balance: members.reduce((s, p) => s + balance[p.id], 0) }
  })

  const grand     = data.people.reduce((s, p) => s + consumed[p.id], 0)
  const totalPaid = data.people.reduce((s, p) => s + paid[p.id], 0)

  function exportCSV() {
    const rows = [['Name', 'Family', 'Consumed (€)', 'Paid (€)', 'Balance (€)']]
    data.people.forEach(p => rows.push([p.name, famName(p.familyId) || '', consumed[p.id].toFixed(2), paid[p.id].toFixed(2), balance[p.id].toFixed(2)]))
    rows.push([], ['EVENT DETAILS'], ['Type', 'Date', 'Name', 'Payer(s)', 'Total (€)', 'Tip (€)'])
    data.events.forEach(e => {
      const t   = e.type === 'grocery' ? e.total : data.entries.filter(en => en.eventId === e.id).reduce((s, en) => s + en.items.reduce((ss, i) => ss + i.price, 0), 0)
      const tip = data.tips?.[e.id]
      rows.push([e.type, e.date, e.name, (e.payerIds || []).map(personName).join(' + '), t.toFixed(2), tip ? tip.amount.toFixed(2) : '0.00'])
    })
    rows.push([], ['PAYMENTS NEEDED'], ['From', '', 'To', 'Amount (€)'])
    txns.forEach(t => rows.push([personName(t.from), '→', personName(t.to), t.amt.toFixed(2)]))
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = `${data.tripName.replace(/\s+/g, '_')}_expenses.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const balanceColor = b => b > 0.01 ? C.green : b < -0.01 ? C.red : C.muted

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary stats */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[{ l: 'Total spent', v: fmt(grand) }, { l: 'Events', v: data.events.length }, { l: 'Avg per person', v: fmt(grand / Math.max(data.people.length, 1)) }].map(s => (
          <Card key={s.l} style={{ flex: '1 1 110px' }}>
            <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.06em' }}>{s.l}</div>
            <div style={{ fontSize: 22, fontWeight: 600, color: C.accent }}>{s.v}</div>
          </Card>
        ))}
      </div>

      {/* Per person */}
      <Card>
        <SecTitle>Per person</SecTitle>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${C.border}` }}>
                {['Name', 'Family', 'Consumed', 'Paid', 'Balance'].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontWeight: 500, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.people.map(p => (
                <tr key={p.id} style={{ borderBottom: `1px solid ${C.border}22` }}>
                  <td style={{ padding: '8px 8px', fontWeight: 500 }}>{p.name}</td>
                  <td style={{ padding: '8px 8px', color: C.muted, fontSize: 12 }}>{famName(p.familyId) || '—'}</td>
                  <td style={{ padding: '8px 8px' }}>{fmt(consumed[p.id])}</td>
                  <td style={{ padding: '8px 8px' }}>{fmt(paid[p.id])}</td>
                  <td style={{ padding: '8px 8px', fontWeight: 600, color: balanceColor(balance[p.id]) }}>
                    {balance[p.id] > 0.01 ? '+' : ''}{fmt(balance[p.id])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Family totals */}
      {famTotals.length > 0 && (
        <Card>
          <SecTitle>Family group totals</SecTitle>
          {famTotals.map(f => (
            <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: `1px solid ${C.border}`, flexWrap: 'wrap', gap: 8 }}>
              <span style={{ fontWeight: 500 }}>{f.name}</span>
              <div style={{ display: 'flex', gap: 16, fontSize: 13, flexWrap: 'wrap' }}>
                <span style={{ color: C.muted }}>consumed {fmt(f.consumed)}</span>
                <span style={{ color: C.muted }}>paid {fmt(f.paid)}</span>
                <span style={{ fontWeight: 600, color: balanceColor(f.balance) }}>{f.balance > 0.01 ? '+' : ''}{fmt(f.balance)}</span>
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Payments */}
      <Card highlight>
        <SecTitle>Simplified payments</SecTitle>
        {txns.length === 0
          ? <div style={{ fontSize: 13, color: C.green, padding: '6px 0' }}>All square — no payments needed! 🎉</div>
          : txns.map((t, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 0', borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontWeight: 500, flex: 1 }}>{personName(t.from)}</span>
              <span style={{ color: C.faint, fontSize: 13 }}>pays</span>
              <span style={{ fontWeight: 500, flex: 1 }}>{personName(t.to)}</span>
              <span style={{ color: C.accent, fontWeight: 600, fontSize: 16 }}>{fmt(t.amt)}</span>
            </div>
          ))
        }
      </Card>

      <Btn onClick={exportCSV} variant='success' full>Export full summary to CSV ↓</Btn>
    </div>
  )
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [syncing,     setSyncing]     = useState(false)
  const [view,        setView]        = useState('setup')
  const [currentUser, setCurrentUser] = useState(null)
  const [showPicker,  setShowPicker]  = useState(false)
  const tripId = useRef(null)
  const subRef = useRef(null)

  // ── Load trip ID ────────────────────────────────────────────────────────────
  useEffect(() => {
    let id = localStorage.getItem(TRIP_ID_KEY)
    if (!id) { id = uid(); localStorage.setItem(TRIP_ID_KEY, id) }
    tripId.current = id

    // Restore current user
    const saved = localStorage.getItem(USER_KEY)
    if (saved) { try { setCurrentUser(JSON.parse(saved)) } catch {} }

    loadAppData(id).then(d => {
      setData(d || INIT_DATA)
      setLoading(false)
    }).catch(() => {
      setData(INIT_DATA)
      setLoading(false)
    })
  }, [])

  // ── Real-time subscription ──────────────────────────────────────────────────
  useEffect(() => {
    if (!tripId.current) return
    const sub = subscribeToTrip(tripId.current, (payload) => {
      setData(payload)
    })
    subRef.current = sub
    return () => { sub.unsubscribe() }
  }, [loading])

  // ── Update helper ───────────────────────────────────────────────────────────
  const update = useCallback((fn) => {
    setData(prev => {
      const next = fn(prev)
      setSyncing(true)
      saveAppData(tripId.current, next)
        .catch(console.error)
        .finally(() => setSyncing(false))
      return next
    })
  }, [])

  const selectUser = (person) => {
    setCurrentUser(person)
    localStorage.setItem(USER_KEY, JSON.stringify(person))
    setShowPicker(false)
  }

  if (loading) return (
    <div style={{ background: C.bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 14 }}>
      Loading…
    </div>
  )

  const VIEWS = [
    { id: 'setup',   label: 'Setup' },
    { id: 'add',     label: 'Add expense' },
    { id: 'receipt', label: 'Receipt scan' },
    { id: 'events',  label: 'Events' },
    { id: 'settle',  label: 'Settle up' },
  ]

  const tripIdShort = tripId.current?.slice(0, 6).toUpperCase()

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text }}>
      {/* Header */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 20px', position: 'sticky', top: 0, background: C.bg, zIndex: 50 }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 54 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: C.accent, letterSpacing: '-.01em' }}>{data.tripName}</span>
            {syncing && <span style={{ fontSize: 11, color: C.faint }}>saving…</span>}
            {!syncing && <span style={{ fontSize: 11, color: C.faint }}>#{tripIdShort}</span>}
          </div>
          <button onClick={() => setShowPicker(true)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 14px', borderRadius: 99, background: currentUser ? C.accent + '22' : C.surface, border: `1px solid ${currentUser ? C.accent + '44' : C.border}`, color: currentUser ? C.accent : C.muted, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: currentUser ? C.accent : C.faint, flexShrink: 0 }} />
            {currentUser ? currentUser.name : 'Who are you?'}
          </button>
        </div>
      </div>

      {/* Nav */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: '0 20px', overflowX: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', gap: 0, whiteSpace: 'nowrap' }}>
          {VIEWS.map(v => (
            <button key={v.id} onClick={() => setView(v.id)} style={{ padding: '11px 14px', fontSize: 13, background: 'transparent', border: 'none', borderBottom: `2px solid ${view === v.id ? C.accent : 'transparent'}`, color: view === v.id ? C.accent : C.muted, cursor: 'pointer', fontFamily: 'inherit', fontWeight: view === v.id ? 500 : 400, transition: 'color .15s' }}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '20px 16px 80px' }}>
        {view === 'setup'   && <SetupView   data={data} update={update} />}
        {view === 'add'     && <AddExpenseView data={data} update={update} currentUser={currentUser} />}
        {view === 'receipt' && <ReceiptView  data={data} update={update} />}
        {view === 'events'  && <EventsView   data={data} update={update} />}
        {view === 'settle'  && <SettleView   data={data} />}
      </div>

      {/* User picker modal */}
      {showPicker && (
        <div onClick={() => setShowPicker(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 24, width: 'min(400px, 92vw)', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Who are you?</div>
            <div style={{ fontSize: 13, color: C.muted, marginBottom: 16 }}>Your name is remembered on this device.</div>
            {data.people.length === 0 && <div style={{ fontSize: 13, color: C.faint }}>Add people in Setup first.</div>}
            {data.people.map(p => (
              <button key={p.id} onClick={() => selectUser(p)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '11px 14px', marginBottom: 6, borderRadius: 8, border: `1px solid ${currentUser?.id === p.id ? C.accent : C.border}`, background: currentUser?.id === p.id ? C.accent + '22' : C.surface, color: C.text, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit', fontWeight: currentUser?.id === p.id ? 600 : 400 }}>
                {currentUser?.id === p.id ? '✓ ' : ''}{p.name}
                {data.families.find(f => f.id === p.familyId) && (
                  <span style={{ fontSize: 12, color: C.muted, marginLeft: 8 }}>{data.families.find(f => f.id === p.familyId)?.name}</span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
