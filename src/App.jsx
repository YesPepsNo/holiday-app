import { useState, useEffect, useCallback, useRef } from 'react'
import { loadAppData, saveAppData, subscribeToTrip } from './supabase.js'

const C = {
  bg: '#0f0f0f', surface: '#1a1a1a', card: '#222', border: '#2e2e2e',
  accent: '#e8c547', text: '#f0ede6', muted: '#888', faint: '#444',
  green: '#4caf6e', red: '#e05252', orange: '#e87d3e', blue: '#5b9bd5',
}

const fmt   = n  => `€${(+n || 0).toFixed(2)}`
const uid   = () => Math.random().toString(36).slice(2, 10)
const today = () => new Date().toISOString().slice(0, 10)
const TRIP_KEY = 'holiday-trip-id'
const USER_KEY = 'holiday-current-user'

function computeStatus(evt, entries, receiptLines) {
  if (evt.type === 'grocery') return 'abgeschlossen'
  const myEntries   = entries.filter(e => e.eventId === evt.id)
  const myLines     = receiptLines.filter(l => l.eventId === evt.id)
  const hasItems    = myEntries.some(e => e.items?.length > 0)
  const hasPayer    = (evt.payerIds?.length || 0) > 0
  const hasReceipt  = myLines.length > 0
  const hasUnmatched = myLines.some(l => l.status === 'unmatched')
  const attendees   = evt.attendeeIds || []
  const missingPeople = attendees.filter(pid => !myEntries.find(e => e.personId === pid && e.items?.length > 0))
  if (!hasItems && !hasPayer && !hasReceipt) return 'neu'
  if (hasItems && !hasPayer && !hasReceipt) return 'in_bearbeitung'
  if (hasPayer && !hasReceipt) return 'bezahlt'
  if (hasReceipt && (hasUnmatched || missingPeople.length > 0)) return 'offene_posten'
  if (hasReceipt && !hasUnmatched && missingPeople.length === 0) return 'abgeschlossen'
  return 'in_bearbeitung'
}

const STATUS = {
  neu:            { de: 'Neu',                   color: '#666' },
  in_bearbeitung: { de: 'In Bearbeitung',         color: '#5b9bd5' },
  bezahlt:        { de: 'Bezahlt',                color: '#e87d3e' },
  quittung_da:    { de: 'Quittung hochgeladen',   color: '#e8c547' },
  offene_posten:  { de: 'Offene Posten',          color: '#e05252' },
  abgeschlossen:  { de: 'Abgeschlossen ✓',        color: '#4caf6e' },
}

const INIT = {
  tripName: 'Urlaub 2025', people: [], families: [], events: [], entries: [], receiptLines: [],
}

// ── Primitives ────────────────────────────────────────────────────────────────

function Btn({ children, onClick, variant = 'default', disabled, full, small, style: s = {} }) {
  const base = { borderRadius: 8, fontFamily: 'inherit', cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? .45 : 1, border: '1px solid', width: full ? '100%' : 'auto', padding: small ? '5px 12px' : '9px 18px', fontSize: small ? 12 : 13, fontWeight: 500 }
  const V = { default: { background: C.card, borderColor: C.border, color: C.text }, primary: { background: C.accent, borderColor: C.accent, color: '#0f0f0f' }, ghost: { background: 'transparent', borderColor: C.border, color: C.muted }, danger: { background: 'transparent', borderColor: C.red+'55', color: C.red }, success: { background: C.green+'22', borderColor: C.green+'55', color: C.green } }
  return <button onClick={onClick} disabled={disabled} style={{ ...base, ...V[variant], ...s }}>{children}</button>
}

const IS = { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 14, color: C.text, fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box' }

// Uncontrolled input - fixes the one-letter-at-a-time bug on mobile
function Input({ label, value, onChange, placeholder, type = 'text', style: s = {}, onKeyDown }) {
  const ref = useRef(null)
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current) ref.current.value = value ?? ''
  }, [value])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>}
      <input ref={ref} type={type} defaultValue={value ?? ''} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} onBlur={e => onChange(e.target.value)}
        onKeyDown={onKeyDown} style={{ ...IS, ...s }} />
    </div>
  )
}

function Sel({ label, value, onChange, options, style: s = {} }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && <label style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>}
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...IS, color: value ? C.text : C.muted, ...s }}>
        <option value=''>Auswählen…</option>
        {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  )
}

function Card({ children, style: s = {}, highlight }) {
  return <div style={{ background: C.card, border: `1px solid ${highlight ? C.accent+'44' : C.border}`, borderRadius: 12, padding: '16px 20px', ...s }}>{children}</div>
}

function SecTitle({ children }) {
  return <div style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.1em', marginBottom: 12, fontWeight: 600 }}>{children}</div>
}

function Pill({ children, color = C.accent, small }) {
  return <span style={{ display: 'inline-block', padding: small ? '2px 8px' : '3px 10px', borderRadius: 99, fontSize: small ? 11 : 12, fontWeight: 600, background: color+'28', color, border: `1px solid ${color}40` }}>{children}</span>
}

function Toast({ msg }) {
  if (!msg) return null
  const ok = msg.startsWith('✓')
  return <div style={{ fontSize: 13, color: ok ? C.green : C.red, padding: '8px 12px', background: ok ? C.green+'20' : C.red+'20', borderRadius: 8, margin: '4px 0' }}>{msg}</div>
}

function ChipSelect({ people, selected, onChange, label, color = C.accent }) {
  const toggle = id => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        {label && <label style={{ fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: '.06em' }}>{label}</label>}
        <div style={{ display: 'flex', gap: 6 }}>
          <Btn onClick={() => onChange(people.map(p => p.id))} variant='ghost' small>Alle</Btn>
          <Btn onClick={() => onChange([])} variant='ghost' small>Keiner</Btn>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
        {people.map(p => {
          const on = selected.includes(p.id)
          return <button key={p.id} onClick={() => toggle(p.id)} style={{ padding: '6px 14px', borderRadius: 99, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', background: on ? color+'28' : C.surface, color: on ? color : C.muted, border: `1px solid ${on ? color : C.border}`, fontWeight: on ? 600 : 400 }}>{p.name}</button>
        })}
      </div>
      <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>{selected.length} von {people.length} ausgewählt</div>
    </div>
  )
}

// ── HEIC helper ───────────────────────────────────────────────────────────────
async function normaliseImage(file) {
  const n = (file.name || '').toLowerCase()
  const isHeic = file.type === 'image/heic' || file.type === 'image/heif' || n.endsWith('.heic') || n.endsWith('.heif')
  if (!isHeic) return file
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height
      cv.getContext('2d').drawImage(img, 0, 0)
      cv.toBlob(blob => { URL.revokeObjectURL(url); blob ? resolve(new File([blob], 'receipt.jpg', { type: 'image/jpeg' })) : reject(new Error('HEIC conversion failed')) }, 'image/jpeg', 0.92)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Cannot load image')) }
    img.src = url
  })
}
async function toBase64(file) {
  return new Promise((ok, err) => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.onerror = err; r.readAsDataURL(file) })
}

// ── Setup ─────────────────────────────────────────────────────────────────────
function SetupView({ data, update }) {
  const [newP, setNewP]       = useState('')
  const [newF, setNewF]       = useState('')
  const [tripName, setTripName] = useState(data.tripName)
  const [sort, setSort]       = useState('manual')
  const [msg, setMsg]         = useState('')
  const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3000) }

  const addPerson = () => { const n = newP.trim(); if (!n) return; update(d => ({ ...d, people: [...d.people, { id: uid(), name: n, familyId: '' }] })); setNewP(''); flash('✓ Hinzugefügt') }
  const addFamily = () => { const n = newF.trim(); if (!n) return; update(d => ({ ...d, families: [...d.families, { id: uid(), name: n }] })); setNewF(''); flash('✓ Gruppe hinzugefügt') }
  const removePerson = id => { if (!confirm('Person entfernen?')) return; update(d => ({ ...d, people: d.people.filter(p => p.id !== id) })) }
  const removeFamily = id => { if (!confirm('Gruppe entfernen?')) return; update(d => ({ ...d, families: d.families.filter(f => f.id !== id), people: d.people.map(p => p.familyId === id ? { ...p, familyId: '' } : p) })) }
  const assignFam = (pid, fid) => update(d => ({ ...d, people: d.people.map(p => p.id === pid ? { ...p, familyId: fid } : p) }))
  const saveName = () => { update(d => ({ ...d, tripName })); flash('✓ Gespeichert') }
  const move = (id, dir) => update(d => {
    const arr = [...d.people]; const i = arr.findIndex(p => p.id === id); const j = i + dir
    if (j < 0 || j >= arr.length) return d; [arr[i], arr[j]] = [arr[j], arr[i]]; return { ...d, people: arr }
  })

  const sorted = [...data.people].sort((a, b) => {
    if (sort === 'alpha')  return a.name.localeCompare(b.name)
    if (sort === 'family') return (a.familyId || 'zzz').localeCompare(b.familyId || 'zzz') || a.name.localeCompare(b.name)
    return 0
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <Toast msg={msg} />
      <Card>
        <SecTitle>Reisename</SecTitle>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={tripName} onChange={setTripName} placeholder='z.B. Gardasee 2025' style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && saveName()} />
          <Btn onClick={saveName} variant='primary'>Speichern</Btn>
        </div>
      </Card>

      <Card>
        <SecTitle>Familiengruppen <span style={{ color: C.faint, fontWeight: 400, fontSize: 10 }}>— optional</span></SecTitle>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Input value={newF} onChange={setNewF} placeholder='z.B. Familie Müller' style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && addFamily()} />
          <Btn onClick={addFamily} variant='primary'>Hinzufügen</Btn>
        </div>
        {!data.families.length && <div style={{ fontSize: 13, color: C.faint }}>Noch keine Gruppen.</div>}
        {data.families.map(f => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 14 }}>{f.name}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: C.faint }}>{data.people.filter(p => p.familyId === f.id).length} Mitglieder</span>
              <Btn onClick={() => removeFamily(f.id)} variant='danger' small>Entfernen</Btn>
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <SecTitle style={{ margin: 0 }}>Personen ({data.people.length})</SecTitle>
          <div style={{ display: 'flex', gap: 5 }}>
            {[['manual','Manuell'],['alpha','A–Z'],['family','Familie']].map(([id,l]) => (
              <button key={id} onClick={() => setSort(id)} style={{ padding: '4px 9px', borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit', background: sort===id ? C.accent+'28' : 'transparent', color: sort===id ? C.accent : C.faint, border: `1px solid ${sort===id ? C.accent+'44' : C.border}` }}>{l}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <Input value={newP} onChange={setNewP} placeholder='Name hinzufügen…' style={{ flex: 1 }} onKeyDown={e => e.key === 'Enter' && addPerson()} />
          <Btn onClick={addPerson} variant='primary'>Hinzufügen</Btn>
        </div>
        {!data.people.length && <div style={{ fontSize: 13, color: C.faint }}>Alle Personen eurer Gruppe hier eintragen.</div>}
        {sorted.map((p, idx) => (
          <div key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: `1px solid ${C.border}` }}>
            {sort === 'manual' && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <button onClick={() => move(p.id,-1)} disabled={idx===0} style={{ background:'none',border:'none',color:C.faint,cursor:'pointer',fontSize:10,padding:'1px 4px',opacity:idx===0?.3:1 }}>▲</button>
                <button onClick={() => move(p.id, 1)} disabled={idx===sorted.length-1} style={{ background:'none',border:'none',color:C.faint,cursor:'pointer',fontSize:10,padding:'1px 4px',opacity:idx===sorted.length-1?.3:1 }}>▼</button>
              </div>
            )}
            <span style={{ flex: 1, fontSize: 14 }}>{p.name}</span>
            {data.families.length > 0 && (
              <select value={p.familyId||''} onChange={e => assignFam(p.id, e.target.value)} style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 8px',fontSize:12,color:p.familyId?C.text:C.muted,fontFamily:'inherit' }}>
                <option value=''>Keine Familie</option>
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
function AddView({ data, update, currentUser }) {
  const [tab, setTab] = useState('event')
  const [msg, setMsg] = useState('')
  const flash = m => { setMsg(m); setTimeout(() => setMsg(''), 3500) }

  // New event
  const [eName, setEName]         = useState('')
  const [eDate, setEDate]         = useState(today())
  const [eAtt,  setEAtt]          = useState([])

  // My order
  const [oEvt,  setOEvt]          = useState('')
  const [oPers, setOPers]         = useState(currentUser?.id||'')
  const [oItems,setOItems]        = useState([{ id:uid(),name:'',price:'' }])

  // Grocery
  const [gDesc, setGDesc]         = useState('')
  const [gDate, setGDate]         = useState(today())
  const [gPayer,setGPayer]        = useState('')
  const [gTotal,setGTotal]        = useState('')
  const [gBens, setGBens]         = useState([])

  useEffect(() => { if (currentUser) setOPers(currentUser.id) }, [currentUser])

  const saveEvent = () => {
    if (!eName||!eDate) return flash('Bitte Name und Datum eingeben.')
    update(d => ({ ...d, events: [...d.events, { id:uid(),type:'dinner',name:eName,date:eDate,attendeeIds:eAtt,payerIds:[],tipAmount:0,tipInReceipt:false,lastEditedBy:currentUser?.name||'',lastEditedAt:new Date().toISOString() }] }))
    setEName(''); setEAtt([]); flash('✓ Veranstaltung gespeichert!')
  }

  const updOItem = (idx,f,v) => setOItems(p => p.map((it,i) => i===idx ? {...it,[f]:v} : it))
  const saveOrder = () => {
    if (!oEvt||!oPers) return flash('Bitte Veranstaltung und Person auswählen.')
    const valid = oItems.filter(i => i.name.trim()&&i.price!=='')
    if (!valid.length) return flash('Mindestens eine Position mit Name und Preis eingeben.')
    const parsed = valid.map(i => ({...i,price:parseFloat(i.price)||0}))
    update(d => {
      const ex = d.entries.find(e => e.eventId===oEvt&&e.personId===oPers)
      if (ex) return {...d,entries:d.entries.map(e => e.id===ex.id ? {...e,items:[...e.items,...parsed]} : e)}
      return {...d,entries:[...d.entries,{id:uid(),eventId:oEvt,personId:oPers,items:parsed}]}
    })
    setOItems([{id:uid(),name:'',price:''}]); flash('✓ Bestellung gespeichert!')
  }

  const saveGrocery = () => {
    if (!gDesc||!gDate||!gPayer||!gTotal||!gBens.length) return flash('Bitte alle Felder ausfüllen.')
    update(d => ({ ...d, events: [...d.events, { id:uid(),type:'grocery',name:gDesc,date:gDate,payerIds:[gPayer],total:parseFloat(gTotal)||0,beneficiaries:gBens,lastEditedBy:currentUser?.name||'',lastEditedAt:new Date().toISOString() }] }))
    setGDesc(''); setGTotal(''); setGBens([]); flash('✓ Einkauf gespeichert!')
  }

  const dinners = data.events.filter(e => e.type==='dinner')
  const T = ({ id, l }) => <button onClick={() => setTab(id)} style={{ padding:'7px 16px',borderRadius:8,fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',background:tab===id?C.accent:C.card,color:tab===id?'#0f0f0f':C.muted,border:`1px solid ${tab===id?C.accent:C.border}` }}>{l}</button>

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
      <div style={{ display:'flex',gap:8,flexWrap:'wrap' }}>
        <T id='event'   l='Neue Veranstaltung' />
        <T id='order'   l='Meine Bestellung' />
        <T id='grocery' l='Einkauf' />
      </div>
      <Toast msg={msg} />

      {tab==='event' && <>
        <Card>
          <SecTitle>Details</SecTitle>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            <div style={{ flex:'2 1 180px' }}><Input label='Name' value={eName} onChange={setEName} placeholder='z.B. La Trattoria' onKeyDown={e => e.key==='Enter'&&saveEvent()} /></div>
            <div style={{ flex:'1 1 130px' }}><Input label='Datum' value={eDate} onChange={setEDate} type='date' /></div>
          </div>
        </Card>
        <Card>
          <ChipSelect people={data.people} selected={eAtt} onChange={setEAtt} label='Wer war dabei?' />
          <div style={{ fontSize:12,color:C.faint,marginTop:8 }}>Zahler und Trinkgeld können später beim Bearbeiten der Veranstaltung hinzugefügt werden.</div>
        </Card>
        <Btn onClick={saveEvent} variant='primary' full>Veranstaltung speichern</Btn>
      </>}

      {tab==='order' && <>
        <Card>
          <SecTitle>Bestellung hinzufügen</SecTitle>
          {!dinners.length
            ? <div style={{ fontSize:13,color:C.faint }}>Noch keine Veranstaltungen — zuerst eine anlegen.</div>
            : <>
              <div style={{ display:'flex',gap:10,flexWrap:'wrap',marginBottom:12 }}>
                <div style={{ flex:'2 1 200px' }}><Sel label='Veranstaltung' value={oEvt} onChange={setOEvt} options={dinners.map(e => ({v:e.id,l:`${e.name} (${e.date})`}))} /></div>
                <div style={{ flex:'1 1 160px' }}><Sel label='Für wen?' value={oPers} onChange={setOPers} options={data.people.map(p => ({v:p.id,l:p.name}))} /></div>
              </div>
              {oItems.map((it,idx) => (
                <div key={it.id} style={{ display:'flex',gap:8,marginBottom:8,alignItems:'flex-end' }}>
                  <div style={{ flex:3 }}><Input value={it.name} onChange={v => updOItem(idx,'name',v)} placeholder='Gericht / Getränk' /></div>
                  <div style={{ flex:1 }}><Input value={it.price} onChange={v => updOItem(idx,'price',v)} placeholder='€' type='number' /></div>
                  <Btn onClick={() => setOItems(p => p.filter((_,i) => i!==idx))} variant='danger' small>×</Btn>
                </div>
              ))}
              <Btn onClick={() => setOItems(p => [...p,{id:uid(),name:'',price:''}])} variant='ghost' small>+ Position</Btn>
            </>
          }
        </Card>
        <Btn onClick={saveOrder} variant='primary' full disabled={!dinners.length}>Bestellung speichern</Btn>
      </>}

      {tab==='grocery' && <>
        <Card>
          <SecTitle>Einkauf</SecTitle>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap',marginBottom:12 }}>
            <div style={{ flex:'2 1 200px' }}><Input label='Beschreibung' value={gDesc} onChange={setGDesc} placeholder='z.B. Supermarkt — Frühstück' onKeyDown={e => e.key==='Enter'&&saveGrocery()} /></div>
            <div style={{ flex:'1 1 130px' }}><Input label='Datum' value={gDate} onChange={setGDate} type='date' /></div>
          </div>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            <div style={{ flex:'1 1 160px' }}><Sel label='Wer hat bezahlt?' value={gPayer} onChange={setGPayer} options={data.people.map(p => ({v:p.id,l:p.name}))} /></div>
            <div style={{ flex:'1 1 110px' }}><Input label='Gesamt (€)' value={gTotal} onChange={setGTotal} type='number' placeholder='0,00' /></div>
          </div>
        </Card>
        <Card><ChipSelect people={data.people} selected={gBens} onChange={setGBens} label='Aufgeteilt zwischen' color={C.green} /></Card>
        <Btn onClick={saveGrocery} variant='primary' full>Einkauf speichern</Btn>
      </>}
    </div>
  )
}

// ── Event Edit Modal ──────────────────────────────────────────────────────────
function EditEventModal({ evt, data, update, currentUser, onClose }) {
  const [name,   setName]   = useState(evt.name)
  const [date,   setDate]   = useState(evt.date)
  const [payers, setPayers] = useState(evt.payerIds||[])
  const [att,    setAtt]    = useState(evt.attendeeIds||[])
  const [tip,    setTip]    = useState(evt.tipAmount?.toString()||'')
  const [tipIn,  setTipIn]  = useState(evt.tipInReceipt||false)

  const save = () => {
    update(d => ({ ...d, events: d.events.map(e => e.id!==evt.id ? e : { ...e,name,date,payerIds:payers,attendeeIds:att,tipAmount:parseFloat(tip)||0,tipInReceipt:tipIn,lastEditedBy:currentUser?.name||'Unbekannt',lastEditedAt:new Date().toISOString() }) }))
    onClose()
  }

  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(520px,100%)',maxHeight:'90vh',overflowY:'auto' }}>
        <div style={{ fontSize:16,fontWeight:600,marginBottom:16 }}>Veranstaltung bearbeiten</div>
        <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            <div style={{ flex:'2 1 160px' }}><Input label='Name' value={name} onChange={setName} /></div>
            <div style={{ flex:'1 1 130px' }}><Input label='Datum' value={date} onChange={setDate} type='date' /></div>
          </div>
          <div>
            <label style={{ fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.06em',display:'block',marginBottom:8 }}>Wer hat bezahlt?</label>
            <div style={{ display:'flex',flexWrap:'wrap',gap:7 }}>
              {data.people.map(p => { const on=payers.includes(p.id); return <button key={p.id} onClick={() => setPayers(prev => on?prev.filter(x=>x!==p.id):[...prev,p.id])} style={{ padding:'6px 14px',borderRadius:99,fontSize:13,cursor:'pointer',fontFamily:'inherit',background:on?C.green+'28':C.surface,color:on?C.green:C.muted,border:`1px solid ${on?C.green:C.border}`,fontWeight:on?600:400 }}>{p.name}</button> })}
            </div>
          </div>
          <ChipSelect people={data.people} selected={att} onChange={setAtt} label='Wer war dabei?' />
          <div style={{ display:'flex',gap:12,flexWrap:'wrap',alignItems:'center' }}>
            <div style={{ flex:'0 0 150px' }}><Input label='Trinkgeld (€)' value={tip} onChange={setTip} type='number' placeholder='0,00' /></div>
            <label style={{ display:'flex',gap:8,alignItems:'center',fontSize:13,color:C.muted,marginTop:18,cursor:'pointer' }}>
              <input type='checkbox' checked={tipIn} onChange={e => setTipIn(e.target.checked)} /> Im Quittungsbetrag enthalten
            </label>
          </div>
          {evt.lastEditedBy && <div style={{ fontSize:11,color:C.faint }}>Zuletzt bearbeitet von <strong>{evt.lastEditedBy}</strong> — {evt.lastEditedAt ? new Date(evt.lastEditedAt).toLocaleString('de-DE') : ''}</div>}
          <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
            <Btn onClick={onClose} variant='ghost'>Abbrechen</Btn>
            <Btn onClick={save} variant='primary'>Speichern</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Item Edit Modal ───────────────────────────────────────────────────────────
function EditItemModal({ entry, pName, update, onClose }) {
  const [items, setItems] = useState(entry.items.map(i => ({...i})))
  const upd = (idx,f,v) => setItems(p => p.map((it,i) => i===idx ? {...it,[f]:v} : it))
  const save = () => {
    update(d => ({ ...d, entries: d.entries.map(e => e.id!==entry.id ? e : {...e,items:items.filter(i=>i.name.trim()).map(i=>({...i,price:parseFloat(i.price)||0}))}) }))
    onClose()
  }
  return (
    <div onClick={onClose} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(480px,100%)',maxHeight:'90vh',overflowY:'auto' }}>
        <div style={{ fontSize:16,fontWeight:600,marginBottom:4 }}>Bestellung bearbeiten</div>
        <div style={{ fontSize:13,color:C.muted,marginBottom:14 }}>{pName}</div>
        {items.map((it,idx) => (
          <div key={it.id||idx} style={{ display:'flex',gap:8,marginBottom:8,alignItems:'flex-end' }}>
            <div style={{ flex:3 }}><Input value={it.name} onChange={v => upd(idx,'name',v)} placeholder='Gericht' /></div>
            <div style={{ flex:1 }}><Input value={it.price?.toString()||''} onChange={v => upd(idx,'price',v)} placeholder='€' type='number' /></div>
            <Btn onClick={() => setItems(p => p.filter((_,i) => i!==idx))} variant='danger' small>×</Btn>
          </div>
        ))}
        <Btn onClick={() => setItems(p => [...p,{id:uid(),name:'',price:''}])} variant='ghost' small style={{ marginBottom:16 }}>+ Position</Btn>
        <div style={{ display:'flex',gap:8,justifyContent:'flex-end' }}>
          <Btn onClick={onClose} variant='ghost'>Abbrechen</Btn>
          <Btn onClick={save} variant='primary'>Speichern</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Receipt View ──────────────────────────────────────────────────────────────
function ReceiptView({ data, update, currentUser }) {
  const [evtId,    setEvtId]   = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanMsg,  setScanMsg]  = useState('')

  const pName       = id => data.people.find(p => p.id===id)?.name||'?'
  const dinners     = data.events.filter(e => e.type==='dinner')
  const evtEntries  = data.entries.filter(e => e.eventId===evtId)
  const evtLines    = data.receiptLines.filter(l => l.eventId===evtId)
  const allItems    = evtEntries.flatMap(en => en.items.map(it => ({...it,personId:en.personId})))

  async function handleFile(file) {
    if (!evtId) { setScanMsg('Zuerst eine Veranstaltung auswählen.'); return }
    setScanning(true); setScanMsg('')
    try {
      const f   = await normaliseImage(file)
      const b64 = await toBase64(f)
      const res = await fetch('/api/scan-receipt', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-20250514', max_tokens:1500,
          messages:[{ role:'user', content:[
            { type:'image', source:{type:'base64',media_type:f.type||'image/jpeg',data:b64} },
            { type:'text', text:'Extract every line item from this restaurant receipt. Return ONLY a valid JSON array, no markdown. Each item: {"name":string,"price":number,"qty":number}. qty defaults to 1. Ignore grand totals/taxes. Example: [{"name":"Tagliatelle","price":14.50,"qty":1},{"name":"Bier","price":18.00,"qty":6}]' }
          ]}]
        })
      })
      const d   = await res.json()
      const txt = (d.content||[]).map(c=>c.text||'').join('')
      let items = []; try { items = JSON.parse(txt.replace(/```[a-z]*\n?|```/g,'').trim()) } catch {}
      if (!items.length) { setScanMsg('Keine Positionen erkannt — bitte ein klareres Foto verwenden.'); setScanning(false); return }
      const newLines = items.map(ri => {
        const nl = ri.name.toLowerCase()
        const match = allItems.find(ei => ei.name.toLowerCase().split(' ').some(w => w.length>3&&nl.includes(w)) || Math.abs(ei.price-ri.price)<0.06)
        return { id:uid(),eventId:evtId,name:ri.name,price:ri.price,qty:ri.qty||1,unitPrice:ri.qty>1?ri.price/ri.qty:ri.price,matchedPersonId:match?.personId||null,status:match?'matched':'unmatched',confirmed:false }
      })
      update(d => ({ ...d, receiptLines:[...d.receiptLines.filter(l=>l.eventId!==evtId),...newLines], events:d.events.map(e=>e.id===evtId?{...e,lastEditedBy:currentUser?.name||'',lastEditedAt:new Date().toISOString()}:e) }))
      const mc = newLines.filter(l=>l.status==='matched').length
      setScanMsg(`✓ ${items.length} Positionen gefunden — ${mc} automatisch zugeordnet, ${items.length-mc} noch offen.`)
    } catch(err) { console.error(err); setScanMsg('Fehler beim Lesen der Quittung — Verbindung prüfen.') }
    setScanning(false)
  }

  const reassign = (lid,pid) => update(d => ({ ...d, receiptLines:d.receiptLines.map(l=>l.id===lid?{...l,matchedPersonId:pid||null,status:pid?'assigned':'unmatched',confirmed:false}:l) }))
  const confirm  = lid => update(d => ({ ...d, receiptLines:d.receiptLines.map(l=>l.id===lid?{...l,confirmed:true}:l) }))

  const matched       = evtLines.filter(l => l.status!=='unmatched')
  const unmatched     = evtLines.filter(l => l.status==='unmatched')
  const receiptTotal  = evtLines.reduce((s,l)=>s+l.price,0)
  const loggedTotal   = allItems.reduce((s,i)=>s+i.price,0)
  const unmatchedAmt  = unmatched.reduce((s,l)=>s+l.price,0)

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
      <Card>
        <SecTitle>Veranstaltung auswählen</SecTitle>
        <Sel value={evtId} onChange={setEvtId} options={dinners.map(e=>({v:e.id,l:`${e.name} — ${e.date}`}))} />
      </Card>

      {evtId && <>
        <Card>
          <SecTitle>Quittungsfoto hochladen</SecTitle>
          <label style={{ display:'block',border:`2px dashed ${C.border}`,borderRadius:10,padding:'2rem',textAlign:'center',cursor:'pointer' }}
            onMouseOver={e=>e.currentTarget.style.borderColor=C.accent} onMouseOut={e=>e.currentTarget.style.borderColor=C.border}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accent}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.border;handleFile(e.dataTransfer.files[0])}}>
            <div style={{ fontSize:32,marginBottom:6 }}>📄</div>
            <div style={{ fontSize:14,color:C.muted }}>Klicken oder Foto hierher ziehen</div>
            <div style={{ fontSize:12,color:C.faint,marginTop:4 }}>Unterstützt JPG, PNG, HEIC (iPhone)</div>
            <input type='file' accept='image/*,.heic,.heif' style={{ display:'none' }} onChange={e=>handleFile(e.target.files[0])} />
          </label>
          {scanning && <div style={{ display:'flex',gap:10,alignItems:'center',marginTop:12,fontSize:13,color:C.muted }}><div style={{ width:14,height:14,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite' }} />KI liest Quittung…</div>}
          {scanMsg && <div style={{ marginTop:10,fontSize:13,color:scanMsg.startsWith('✓')?C.green:C.red }}>{scanMsg}</div>}
        </Card>

        {evtLines.length>0 && <>
          <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
            {[{l:'Eingetragene Positionen',v:fmt(loggedTotal),c:C.accent},{l:'Quittungssumme',v:fmt(receiptTotal),c:C.green},{l:'Nicht zugeordnet',v:fmt(unmatchedAmt),c:unmatched.length?C.red:C.faint}].map(s=>(
              <Card key={s.l} style={{ flex:'1 1 110px' }}>
                <div style={{ fontSize:11,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'.05em' }}>{s.l}</div>
                <div style={{ fontSize:20,fontWeight:600,color:s.c }}>{s.v}</div>
              </Card>
            ))}
          </div>

          {unmatched.length>0 && (
            <Card highlight>
              <SecTitle>⚠ Noch zuzuordnen ({unmatched.length})</SecTitle>
              {unmatched.map(line => (
                <div key={line.id} style={{ marginBottom:8,padding:'10px 12px',background:C.orange+'15',borderRadius:8,border:`1px solid ${C.orange}33` }}>
                  <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap' }}>
                    <span style={{ flex:2,fontSize:14 }}>{line.name}{line.qty>1?` ×${line.qty}`:''}</span>
                    <span style={{ fontSize:13,color:C.accent,fontWeight:600 }}>{fmt(line.price)}</span>
                    {line.qty>1 && <span style={{ fontSize:11,color:C.muted }}>{fmt(line.unitPrice)} / Stück</span>}
                    <select value={line.matchedPersonId||''} onChange={e=>reassign(line.id,e.target.value)} style={{ flex:1,minWidth:120,background:C.surface,border:`1px solid ${C.orange}55`,borderRadius:6,padding:'6px 8px',fontSize:13,color:line.matchedPersonId?C.text:C.muted,fontFamily:'inherit' }}>
                      <option value=''>Zuordnen…</option>
                      {data.people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </Card>
          )}

          <Card>
            <SecTitle>✓ Zugeordnet ({matched.length})</SecTitle>
            {!matched.length && <div style={{ fontSize:13,color:C.faint }}>Noch keine zugeordneten Positionen.</div>}
            {matched.map(line => {
              const person = data.people.find(p=>p.id===line.matchedPersonId)
              return (
                <div key={line.id} style={{ display:'flex',gap:8,alignItems:'center',marginBottom:6,padding:'8px 12px',background:line.confirmed?C.green+'12':C.surface,borderRadius:8,border:`1px solid ${line.confirmed?C.green+'33':C.border}` }}>
                  <span style={{ flex:2,fontSize:13 }}>{line.name}{line.qty>1?` ×${line.qty}`:''}</span>
                  <span style={{ fontSize:12,color:C.muted }}>{fmt(line.price)}</span>
                  <span style={{ fontSize:12,color:C.green,flex:1 }}>{person?.name||'—'}</span>
                  {!line.confirmed ? <Btn onClick={()=>confirm(line.id)} variant='success' small>Bestätigen</Btn> : <span style={{ fontSize:11,color:C.green }}>✓</span>}
                  <select value={line.matchedPersonId||''} onChange={e=>reassign(line.id,e.target.value)} style={{ background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 6px',fontSize:11,color:C.muted,fontFamily:'inherit' }}>
                    <option value=''>Neu zuordnen…</option>
                    {data.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
              )
            })}
          </Card>
        </>}
      </>}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

// ── Events View ───────────────────────────────────────────────────────────────
function EventsView({ data, update, currentUser }) {
  const [expanded,  setExpanded]  = useState({})
  const [editEvt,   setEditEvt]   = useState(null)
  const [editEntry, setEditEntry] = useState(null)
  const pName = id => data.people.find(p=>p.id===id)?.name||'?'
  const toggle = id => setExpanded(prev=>({...prev,[id]:!prev[id]}))
  const delEvt = id => { if (!confirm('Veranstaltung löschen?')) return; update(d=>({...d,events:d.events.filter(e=>e.id!==id),entries:d.entries.filter(e=>e.eventId!==id),receiptLines:d.receiptLines.filter(l=>l.eventId!==id)})) }

  const sorted = [...data.events].sort((a,b)=>b.date.localeCompare(a.date))
  if (!sorted.length) return <div style={{ padding:'3rem',textAlign:'center',color:C.faint,fontSize:14 }}>Noch keine Veranstaltungen.</div>

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:12 }}>
      {sorted.map(evt => {
        const entries     = data.entries.filter(e=>e.eventId===evt.id)
        const lines       = data.receiptLines.filter(l=>l.eventId===evt.id)
        const loggedTotal = evt.type==='grocery' ? evt.total : entries.reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0)
        const rcptTotal   = lines.reduce((s,l)=>s+l.price,0)
        const unmatchAmt  = lines.filter(l=>l.status==='unmatched').reduce((s,l)=>s+l.price,0)
        const tip         = evt.tipAmount||0
        const status      = computeStatus(evt,entries,lines)
        const si          = STATUS[status]||STATUS.neu
        const open        = expanded[evt.id]

        return (
          <Card key={evt.id}>
            <div style={{ display:'flex',justifyContent:'space-between',gap:10,marginBottom:8 }}>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:4 }}>
                  <Pill color={evt.type==='grocery'?C.green:C.accent}>{evt.type==='grocery'?'Einkauf':'Abendessen'}</Pill>
                  <Pill color={si.color} small>{si.de}</Pill>
                </div>
                <div style={{ fontWeight:600,fontSize:15,marginBottom:2 }}>{evt.name}</div>
                <div style={{ fontSize:12,color:C.muted }}>{evt.date}</div>
              </div>
              <div style={{ textAlign:'right',flexShrink:0 }}>
                <div style={{ fontSize:18,fontWeight:600,color:C.accent }}>{fmt(loggedTotal)}</div>
                {lines.length>0 && <div style={{ fontSize:13,color:C.green }}>{fmt(rcptTotal)}</div>}
                {unmatchAmt>0 && <div style={{ fontSize:12,color:C.red }}>{fmt(unmatchAmt)} offen</div>}
                {tip>0 && <div style={{ fontSize:11,color:C.muted }}>+{fmt(tip)} Trinkgeld</div>}
              </div>
            </div>

            {evt.payerIds?.length>0 && <div style={{ fontSize:12,color:C.muted,marginBottom:3 }}>Bezahlt von: <strong style={{ color:C.text }}>{evt.payerIds.map(pName).join(', ')}</strong></div>}
            {evt.attendeeIds?.length>0 && <div style={{ fontSize:12,color:C.muted,marginBottom:6 }}>Teilnehmer: {evt.attendeeIds.map(pName).join(', ')}</div>}

            {open && evt.type==='dinner' && (
              <div style={{ borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:4,marginBottom:8 }}>
                {!entries.length
                  ? <div style={{ fontSize:13,color:C.faint }}>Noch keine Bestellungen eingetragen.</div>
                  : entries.map(en => (
                    <div key={en.id} style={{ marginBottom:8,padding:'8px 10px',background:C.surface,borderRadius:8 }}>
                      <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4 }}>
                        <span style={{ fontSize:13,color:C.accent,fontWeight:500 }}>{pName(en.personId)}</span>
                        <div style={{ display:'flex',gap:6,alignItems:'center' }}>
                          <span style={{ fontSize:12,color:C.muted }}>{fmt(en.items.reduce((s,i)=>s+i.price,0))}</span>
                          <Btn onClick={()=>setEditEntry(en)} variant='ghost' small>Bearbeiten</Btn>
                        </div>
                      </div>
                      {en.items.map((i,ii) => <div key={i.id||ii} style={{ display:'flex',justifyContent:'space-between',fontSize:12,color:C.muted,paddingLeft:8 }}><span>{i.name}</span><span>{fmt(i.price)}</span></div>)}
                    </div>
                  ))
                }
              </div>
            )}

            <div style={{ display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:4 }}>
              <Btn onClick={()=>toggle(evt.id)} variant='ghost' small>{open?'▲ Weniger':'▼ Details'}</Btn>
              <Btn onClick={()=>{ if(!currentUser){alert('Bitte zuerst auswählen, wer du bist.');return}; setEditEvt(evt) }} variant='default' small>Bearbeiten</Btn>
              <Btn onClick={()=>delEvt(evt.id)} variant='danger' small style={{ marginLeft:'auto' }}>Löschen</Btn>
            </div>
            {evt.lastEditedBy && <div style={{ fontSize:11,color:C.faint,marginTop:6 }}>Zuletzt bearbeitet von <strong>{evt.lastEditedBy}</strong></div>}
          </Card>
        )
      })}
      {editEvt && <EditEventModal evt={editEvt} data={data} update={update} currentUser={currentUser} onClose={()=>setEditEvt(null)} />}
      {editEntry && <EditItemModal entry={editEntry} pName={pName(editEntry.personId)} update={update} onClose={()=>setEditEntry(null)} />}
    </div>
  )
}

// ── Settle View ───────────────────────────────────────────────────────────────
function SettleView({ data }) {
  const pName  = id => data.people.find(p=>p.id===id)?.name||'?'
  const fName  = id => data.families.find(f=>f.id===id)?.name
  const consumed={}, paid={}
  data.people.forEach(p=>{consumed[p.id]=0;paid[p.id]=0})

  data.events.forEach(evt => {
    if (evt.type==='grocery') {
      const share = evt.total/Math.max(evt.beneficiaries?.length||1,1)
      ;(evt.beneficiaries||[]).forEach(pid=>{if(consumed[pid]!==undefined)consumed[pid]+=share})
      const p=evt.payerIds?.[0]; if(p&&paid[p]!==undefined)paid[p]+=evt.total
    } else {
      const tip   = evt.tipAmount||0
      const diners= evt.attendeeIds?.length ? evt.attendeeIds : data.entries.filter(e=>e.eventId===evt.id).map(e=>e.personId)
      const ents  = data.entries.filter(e=>e.eventId===evt.id)
      ents.forEach(en=>{const s=en.items.reduce((ss,i)=>ss+i.price,0);if(consumed[en.personId]!==undefined)consumed[en.personId]+=s})
      if(diners.length&&tip){const ph=tip/diners.length;diners.forEach(pid=>{if(consumed[pid]!==undefined)consumed[pid]+=ph})}
      const dTotal=ents.reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0)
      const pc=evt.payerIds?.length||0
      if(pc)evt.payerIds.forEach(pid=>{if(paid[pid]!==undefined)paid[pid]+=(dTotal+tip)/pc})
    }
  })

  const bal={}; data.people.forEach(p=>{bal[p.id]=paid[p.id]-consumed[p.id]})
  const debtors=data.people.filter(p=>bal[p.id]<-0.01).map(p=>({id:p.id,amt:-bal[p.id]}))
  const creditors=data.people.filter(p=>bal[p.id]>0.01).map(p=>({id:p.id,amt:bal[p.id]}))
  const txns=[]; const D=debtors.map(x=>({...x})),CR=creditors.map(x=>({...x}))
  let di=0,ci=0
  while(di<D.length&&ci<CR.length){const pay=Math.min(D[di].amt,CR[ci].amt);if(pay>0.01)txns.push({from:D[di].id,to:CR[ci].id,amt:pay});D[di].amt-=pay;CR[ci].amt-=pay;if(D[di].amt<0.01)di++;if(CR[ci].amt<0.01)ci++}

  const famT=data.families.map(f=>{const m=data.people.filter(p=>p.familyId===f.id);return{...f,consumed:m.reduce((s,p)=>s+consumed[p.id],0),paid:m.reduce((s,p)=>s+paid[p.id],0),balance:m.reduce((s,p)=>s+bal[p.id],0)}})
  const grand=data.people.reduce((s,p)=>s+consumed[p.id],0)
  const bc=b=>b>0.01?C.green:b<-0.01?C.red:C.muted

  function exportCSV(){
    const rows=[['Name','Familie','Verbraucht (€)','Bezahlt (€)','Saldo (€)']]
    data.people.forEach(p=>rows.push([p.name,fName(p.familyId)||'',consumed[p.id].toFixed(2),paid[p.id].toFixed(2),bal[p.id].toFixed(2)]))
    rows.push([],['VERANSTALTUNGEN'],['Typ','Datum','Name','Bezahlt von','Gesamt (€)','Trinkgeld (€)'])
    data.events.forEach(e=>{const t=e.type==='grocery'?e.total:data.entries.filter(en=>en.eventId===e.id).reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0);rows.push([e.type==='grocery'?'Einkauf':'Abendessen',e.date,e.name,(e.payerIds||[]).map(pName).join(' + '),t.toFixed(2),(e.tipAmount||0).toFixed(2)])})
    rows.push([],['ZAHLUNGEN'],['Von','','An','Betrag (€)'])
    txns.forEach(t=>rows.push([pName(t.from),'→',pName(t.to),t.amt.toFixed(2)]))
    const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
    const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${data.tripName.replace(/\s+/g,'_')}_Abrechnung.csv`;a.click();URL.revokeObjectURL(url)
  }

  return (
    <div style={{ display:'flex',flexDirection:'column',gap:14 }}>
      <div style={{ display:'flex',gap:10,flexWrap:'wrap' }}>
        {[{l:'Gesamtausgaben',v:fmt(grand)},{l:'Veranstaltungen',v:data.events.length},{l:'Ø pro Person',v:fmt(grand/Math.max(data.people.length,1))}].map(s=>(
          <Card key={s.l} style={{ flex:'1 1 110px' }}>
            <div style={{ fontSize:11,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em' }}>{s.l}</div>
            <div style={{ fontSize:22,fontWeight:600,color:C.accent }}>{s.v}</div>
          </Card>
        ))}
      </div>
      <Card>
        <SecTitle>Übersicht pro Person</SecTitle>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%',borderCollapse:'collapse',fontSize:13 }}>
            <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{['Name','Familie','Verbraucht','Bezahlt','Saldo'].map(h=><th key={h} style={{ textAlign:'left',padding:'6px 8px',color:C.muted,fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'.04em',whiteSpace:'nowrap' }}>{h}</th>)}</tr></thead>
            <tbody>{data.people.map(p=><tr key={p.id} style={{ borderBottom:`1px solid ${C.border}22` }}><td style={{ padding:'8px 8px',fontWeight:500 }}>{p.name}</td><td style={{ padding:'8px 8px',color:C.muted,fontSize:12 }}>{fName(p.familyId)||'—'}</td><td style={{ padding:'8px 8px' }}>{fmt(consumed[p.id])}</td><td style={{ padding:'8px 8px' }}>{fmt(paid[p.id])}</td><td style={{ padding:'8px 8px',fontWeight:600,color:bc(bal[p.id]) }}>{bal[p.id]>0.01?'+':''}{fmt(bal[p.id])}</td></tr>)}</tbody>
          </table>
        </div>
      </Card>
      {famT.length>0 && <Card><SecTitle>Familiengruppen</SecTitle>{famT.map(f=><div key={f.id} style={{ display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${C.border}`,flexWrap:'wrap',gap:8 }}><span style={{ fontWeight:500 }}>{f.name}</span><div style={{ display:'flex',gap:16,fontSize:13 }}><span style={{ color:C.muted }}>verbraucht {fmt(f.consumed)}</span><span style={{ color:C.muted }}>bezahlt {fmt(f.paid)}</span><span style={{ fontWeight:600,color:bc(f.balance) }}>{f.balance>0.01?'+':''}{fmt(f.balance)}</span></div></div>)}</Card>}
      <Card highlight>
        <SecTitle>Zahlungen</SecTitle>
        {!txns.length ? <div style={{ fontSize:13,color:C.green,padding:'6px 0' }}>Alles ausgeglichen — keine Zahlungen nötig! 🎉</div>
          : txns.map((t,i)=><div key={i} style={{ display:'flex',alignItems:'center',gap:10,padding:'11px 0',borderBottom:`1px solid ${C.border}` }}><span style={{ fontWeight:500,flex:1 }}>{pName(t.from)}</span><span style={{ color:C.faint,fontSize:13 }}>zahlt</span><span style={{ fontWeight:500,flex:1 }}>{pName(t.to)}</span><span style={{ color:C.accent,fontWeight:600,fontSize:16 }}>{fmt(t.amt)}</span></div>)
        }
      </Card>
      <Btn onClick={exportCSV} variant='success' full>Gesamtübersicht als CSV exportieren ↓</Btn>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [syncing,    setSyncing]    = useState(false)
  const [view,       setView]       = useState('setup')
  const [currUser,   setCurrUser]   = useState(null)
  const [showPicker, setShowPicker] = useState(false)
  const tripId = useRef(null)

  useEffect(()=>{
    let id=localStorage.getItem(TRIP_KEY); if(!id){id=uid();localStorage.setItem(TRIP_KEY,id)}; tripId.current=id
    const saved=localStorage.getItem(USER_KEY); if(saved){try{setCurrUser(JSON.parse(saved))}catch{}}
    loadAppData(id).then(d=>{setData(d||INIT);setLoading(false)}).catch(()=>{setData(INIT);setLoading(false)})
  },[])

  useEffect(()=>{
    if(!tripId.current||loading)return
    const sub=subscribeToTrip(tripId.current,payload=>setData(payload))
    return ()=>sub.unsubscribe()
  },[loading])

  const update=useCallback(fn=>{
    setData(prev=>{const next=fn(prev);setSyncing(true);saveAppData(tripId.current,next).catch(console.error).finally(()=>setSyncing(false));return next})
  },[])

  const selectUser=p=>{setCurrUser(p);localStorage.setItem(USER_KEY,JSON.stringify(p));setShowPicker(false)}

  if(loading)return<div style={{ background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted,fontSize:14 }}>Wird geladen…</div>

  const VIEWS=[{id:'setup',l:'Einstellungen'},{id:'add',l:'Hinzufügen'},{id:'receipt',l:'Quittung'},{id:'events',l:'Veranstaltungen'},{id:'settle',l:'Abrechnung'}]

  return (
    <div style={{ background:C.bg,minHeight:'100vh',color:C.text }}>
      <div style={{ borderBottom:`1px solid ${C.border}`,padding:'0 20px',position:'sticky',top:0,background:C.bg,zIndex:50 }}>
        <div style={{ maxWidth:760,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',height:54 }}>
          <div style={{ display:'flex',alignItems:'baseline',gap:10 }}>
            <span style={{ fontSize:17,fontWeight:600,color:C.accent }}>{data.tripName}</span>
            <span style={{ fontSize:11,color:syncing?C.muted:C.faint }}>{syncing?'Speichern…':`#${tripId.current?.slice(0,6).toUpperCase()}`}</span>
          </div>
          <button onClick={()=>setShowPicker(true)} style={{ display:'flex',alignItems:'center',gap:8,padding:'5px 14px',borderRadius:99,background:currUser?C.accent+'22':C.surface,border:`1px solid ${currUser?C.accent+'44':C.border}`,color:currUser?C.accent:C.muted,fontSize:13,cursor:'pointer',fontFamily:'inherit' }}>
            <span style={{ width:7,height:7,borderRadius:'50%',background:currUser?C.accent:C.faint,flexShrink:0 }} />
            {currUser?currUser.name:'Wer bist du?'}
          </button>
        </div>
      </div>
      <div style={{ borderBottom:`1px solid ${C.border}`,padding:'0 16px',overflowX:'auto' }}>
        <div style={{ maxWidth:760,margin:'0 auto',display:'flex',whiteSpace:'nowrap' }}>
          {VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{ padding:'11px 12px',fontSize:13,background:'transparent',border:'none',borderBottom:`2px solid ${view===v.id?C.accent:'transparent'}`,color:view===v.id?C.accent:C.muted,cursor:'pointer',fontFamily:'inherit',fontWeight:view===v.id?500:400 }}>{v.l}</button>)}
        </div>
      </div>
      <div style={{ maxWidth:760,margin:'0 auto',padding:'20px 16px 80px' }}>
        {view==='setup'   && <SetupView   data={data} update={update} />}
        {view==='add'     && <AddView     data={data} update={update} currentUser={currUser} />}
        {view==='receipt' && <ReceiptView data={data} update={update} currentUser={currUser} />}
        {view==='events'  && <EventsView  data={data} update={update} currentUser={currUser} />}
        {view==='settle'  && <SettleView  data={data} />}
      </div>
      {showPicker && (
        <div onClick={()=>setShowPicker(false)} style={{ position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100 }}>
          <div onClick={e=>e.stopPropagation()} style={{ background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(400px,92vw)',maxHeight:'80vh',overflowY:'auto' }}>
            <div style={{ fontSize:16,fontWeight:600,marginBottom:4 }}>Wer bist du?</div>
            <div style={{ fontSize:13,color:C.muted,marginBottom:16 }}>Dein Name wird auf diesem Gerät gespeichert.</div>
            {!data.people.length && <div style={{ fontSize:13,color:C.faint }}>Zuerst Personen unter „Einstellungen" hinzufügen.</div>}
            {data.people.map(p=>(
              <button key={p.id} onClick={()=>selectUser(p)} style={{ display:'block',width:'100%',textAlign:'left',padding:'11px 14px',marginBottom:6,borderRadius:8,border:`1px solid ${currUser?.id===p.id?C.accent:C.border}`,background:currUser?.id===p.id?C.accent+'22':C.surface,color:C.text,fontSize:14,cursor:'pointer',fontFamily:'inherit',fontWeight:currUser?.id===p.id?600:400 }}>
                {currUser?.id===p.id?'✓ ':''}{p.name}
                {data.families.find(f=>f.id===p.familyId)&&<span style={{ fontSize:12,color:C.muted,marginLeft:8 }}>{data.families.find(f=>f.id===p.familyId)?.name}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
