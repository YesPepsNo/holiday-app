import { useState, useEffect, useCallback, useRef } from 'react'
import { loadAppData, saveAppData, subscribeToTrip } from './supabase.js'

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:'#0f0f0f', surface:'#1a1a1a', card:'#222', border:'#2e2e2e',
  accent:'#e8c547', text:'#f0ede6', muted:'#888', faint:'#444',
  green:'#4caf6e', red:'#e05252', orange:'#e87d3e', blue:'#5b9bd5',
}
const fmt   = n  => `€${(+n||0).toFixed(2)}`
const uid   = () => Math.random().toString(36).slice(2,10)
const today = () => new Date().toISOString().slice(0,10)
const TRIP_KEY = 'holiday-trip-id'
const USER_KEY = 'holiday-current-user'

// ── Event categories ──────────────────────────────────────────────────────────
const CATEGORIES = [
  { id:'dinner',   de:'Abendessen', color:'#e8c547' },
  { id:'drinks',   de:'Getränke',   color:'#5b9bd5' },
  { id:'other',    de:'Sonstiges',  color:'#888'    },
  { id:'grocery',  de:'Einkauf',    color:'#4caf6e' },
]
const catInfo = id => CATEGORIES.find(c=>c.id===id) || CATEGORIES[0]

// ── Status ────────────────────────────────────────────────────────────────────
const STATUS = {
  neu:            { de:'Neu',                  color:'#555' },
  in_bearbeitung: { de:'In Bearbeitung',        color:'#5b9bd5' },
  bezahlt:        { de:'Bezahlt',               color:'#e87d3e' },
  quittung_da:    { de:'Quittung hochgeladen',  color:'#e8c547' },
  offene_posten:  { de:'Offene Posten',         color:'#e05252' },
  abgeschlossen:  { de:'Abgeschlossen ✓',       color:'#4caf6e' },
}

function computeStatus(evt, entries, lines) {
  const isGrocery = evt.category === 'grocery'
  const hasItems    = isGrocery ? true : entries.filter(e=>e.eventId===evt.id).some(e=>e.items?.length>0)
  const hasPayer    = (evt.payerIds?.length||0)>0
  const hasReceipt  = lines.filter(l=>l.eventId===evt.id).length>0
  const noReceiptOk = evt.noReceiptAvailable
  const hasUnmatched = lines.filter(l=>l.eventId===evt.id).some(l=>l.status==='unmatched')
  const attendees   = evt.attendeeIds||[]
  const myEntries   = entries.filter(e=>e.eventId===evt.id)
  const missingPpl  = attendees.filter(pid=>!myEntries.find(e=>e.personId===pid&&e.items?.length>0))

  if (!hasPayer && !hasItems && !hasReceipt) return 'neu'
  if (hasItems && !hasPayer && !hasReceipt)  return 'in_bearbeitung'
  if (hasPayer && !hasReceipt && !noReceiptOk) return 'bezahlt'
  if (hasReceipt && (hasUnmatched || missingPpl.length>0)) return 'offene_posten'
  if ((hasReceipt || noReceiptOk) && !hasUnmatched && (!attendees.length || !missingPpl.length)) return 'abgeschlossen'
  return 'in_bearbeitung'
}

// ── Init data ─────────────────────────────────────────────────────────────────
const INIT = {
  tripName:'Urlaub 2025', tripNameEditedBy:'', tripNameEditedAt:'',
  people:[], families:[], events:[], entries:[], receiptLines:[],
}

// ── Primitives ────────────────────────────────────────────────────────────────
function Btn({children,onClick,variant='default',disabled,full,small,style:s={}}) {
  const base={borderRadius:8,fontFamily:'inherit',cursor:disabled?'not-allowed':'pointer',opacity:disabled?.45:1,border:'1px solid',width:full?'100%':'auto',padding:small?'5px 12px':'9px 18px',fontSize:small?12:13,fontWeight:500,transition:'opacity .15s'}
  const V={default:{background:C.card,borderColor:C.border,color:C.text},primary:{background:C.accent,borderColor:C.accent,color:'#0f0f0f'},ghost:{background:'transparent',borderColor:C.border,color:C.muted},danger:{background:'transparent',borderColor:C.red+'55',color:C.red},success:{background:C.green+'22',borderColor:C.green+'55',color:C.green},warn:{background:C.orange+'22',borderColor:C.orange+'55',color:C.orange}}
  return <button onClick={onClick} disabled={disabled} style={{...base,...V[variant],...s}}>{children}</button>
}
const IS={background:C.surface,border:`1px solid ${C.border}`,borderRadius:8,padding:'8px 12px',fontSize:14,color:C.text,fontFamily:'inherit',outline:'none',width:'100%',boxSizing:'border-box'}

function Input({label,value,onChange,placeholder,type='text',style:s={},onKeyDown}) {
  const ref=useRef(null)
  useEffect(()=>{if(ref.current&&document.activeElement!==ref.current)ref.current.value=value??''},[value])
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {label&&<label style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.06em'}}>{label}</label>}
      <input ref={ref} type={type} defaultValue={value??''} placeholder={placeholder}
        onChange={e=>onChange(e.target.value)} onBlur={e=>onChange(e.target.value)}
        onKeyDown={onKeyDown} style={{...IS,...s}}/>
    </div>
  )
}
function Sel({label,value,onChange,options,style:s={}}) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:4}}>
      {label&&<label style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.06em'}}>{label}</label>}
      <select value={value} onChange={e=>onChange(e.target.value)} style={{...IS,color:value?C.text:C.muted,...s}}>
        <option value=''>Auswählen…</option>
        {options.map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </div>
  )
}
function Card({children,style:s={},highlight,color}) {
  return <div style={{background:C.card,border:`1px solid ${color?color+'44':highlight?C.accent+'44':C.border}`,borderRadius:12,padding:'16px 20px',...s}}>{children}</div>
}
function SecTitle({children}) {
  return <div style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.1em',marginBottom:12,fontWeight:600}}>{children}</div>
}
function Pill({children,color=C.accent,small}) {
  return <span style={{display:'inline-block',padding:small?'2px 8px':'3px 10px',borderRadius:99,fontSize:small?11:12,fontWeight:600,background:color+'28',color,border:`1px solid ${color}40`}}>{children}</span>
}
function Toast({msg}) {
  if(!msg) return null
  const ok=msg.startsWith('✓')
  return <div style={{fontSize:13,color:ok?C.green:C.red,padding:'8px 12px',background:ok?C.green+'20':C.red+'20',borderRadius:8,margin:'4px 0'}}>{msg}</div>
}
function ChipSelect({people,selected,onChange,label,color=C.accent}) {
  const toggle=id=>onChange(selected.includes(id)?selected.filter(x=>x!==id):[...selected,id])
  return (
    <div>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
        {label&&<label style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.06em'}}>{label}</label>}
        <div style={{display:'flex',gap:6}}>
          <Btn onClick={()=>onChange(people.map(p=>p.id))} variant='ghost' small>Alle</Btn>
          <Btn onClick={()=>onChange([])} variant='ghost' small>Keiner</Btn>
        </div>
      </div>
      <div style={{display:'flex',flexWrap:'wrap',gap:7}}>
        {people.map(p=>{const on=selected.includes(p.id);return <button key={p.id} onClick={()=>toggle(p.id)} style={{padding:'6px 14px',borderRadius:99,fontSize:13,cursor:'pointer',fontFamily:'inherit',background:on?color+'28':C.surface,color:on?color:C.muted,border:`1px solid ${on?color:C.border}`,fontWeight:on?600:400}}>{p.name}</button>})}
      </div>
      <div style={{fontSize:12,color:C.faint,marginTop:6}}>{selected.length} von {people.length} ausgewählt</div>
    </div>
  )
}

// ── HEIC / image helpers ──────────────────────────────────────────────────────
async function normaliseImage(file) {
  const n=(file.name||'').toLowerCase()
  const isHeic=file.type==='image/heic'||file.type==='image/heif'||n.endsWith('.heic')||n.endsWith('.heif')
  if(!isHeic) return file
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file); const img=new Image()
    img.onload=()=>{
      const cv=document.createElement('canvas');cv.width=img.width;cv.height=img.height
      cv.getContext('2d').drawImage(img,0,0)
      cv.toBlob(blob=>{URL.revokeObjectURL(url);blob?resolve(new File([blob],'receipt.jpg',{type:'image/jpeg'})):reject(new Error('HEIC conversion failed'))},'image/jpeg',0.92)
    }
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Cannot load image'))}
    img.src=url
  })
}
async function toBase64(file) {
  return new Promise((ok,err)=>{const r=new FileReader();r.onload=()=>ok(r.result.split(',')[1]);r.onerror=err;r.readAsDataURL(file)})
}

// ── Drag-and-drop list ────────────────────────────────────────────────────────
function DraggableList({items,onReorder,renderItem}) {
  const dragIdx=useRef(null)
  const onDragStart=(e,i)=>{dragIdx.current=i;e.dataTransfer.effectAllowed='move'}
  const onDragOver=(e,i)=>{
    e.preventDefault()
    if(dragIdx.current===null||dragIdx.current===i) return
    const arr=[...items];const [moved]=arr.splice(dragIdx.current,1);arr.splice(i,0,moved)
    dragIdx.current=i;onReorder(arr)
  }
  const onDrop=()=>{dragIdx.current=null}
  return <>{items.map((item,i)=>(
    <div key={item.id} draggable onDragStart={e=>onDragStart(e,i)} onDragOver={e=>onDragOver(e,i)} onDrop={onDrop}
      style={{cursor:'grab',userSelect:'none'}}>
      {renderItem(item,i)}
    </div>
  ))}</>
}

// ── Setup View ────────────────────────────────────────────────────────────────
function SetupView({data,update,currentUser}) {
  const [newP,setNewP]=useState('')
  const [newF,setNewF]=useState('')
  const [tripName,setTripName]=useState(data.tripName)
  const [pSort,setPSort]=useState('manual')
  const [fSort,setFSort]=useState('manual')
  const [msg,setMsg]=useState('')
  const flash=m=>{setMsg(m);setTimeout(()=>setMsg(''),3000)}
  const canEdit=!!currentUser

  const addPerson=()=>{
    const n=newP.trim();if(!n)return
    update(d=>({...d,people:[...d.people,{id:uid(),name:n,familyId:''}]}))
    setNewP('');flash('✓ Hinzugefügt')
  }
  const addFamily=()=>{
    const n=newF.trim();if(!n)return
    update(d=>({...d,families:[...d.families,{id:uid(),name:n}]}))
    setNewF('');flash('✓ Gruppe hinzugefügt')
  }
  const removePerson=id=>{if(!confirm('Person entfernen?'))return;update(d=>({...d,people:d.people.filter(p=>p.id!==id)}))}
  const removeFamily=id=>{if(!confirm('Gruppe entfernen?'))return;update(d=>({...d,families:d.families.filter(f=>f.id!==id),people:d.people.map(p=>p.familyId===id?{...p,familyId:''}:p)}))}
  const assignFam=(pid,fid)=>update(d=>({...d,people:d.people.map(p=>p.id===pid?{...p,familyId:fid}:p)}))
  const saveName=()=>{
    if(!canEdit){alert('Bitte zuerst auswählen, wer du bist.');return}
    update(d=>({...d,tripName,tripNameEditedBy:currentUser.name,tripNameEditedAt:new Date().toISOString()}))
    flash('✓ Gespeichert')
  }

  const sortedPeople=[...data.people].sort((a,b)=>pSort==='alpha'?a.name.localeCompare(b.name):pSort==='family'?(a.familyId||'zzz').localeCompare(b.familyId||'zzz')||a.name.localeCompare(b.name):0)
  const sortedFamilies=[...data.families].sort((a,b)=>fSort==='alpha'?a.name.localeCompare(b.name):0)

  const SortBtns=({val,set})=>(
    <div style={{display:'flex',gap:5}}>
      {[['manual','Manuell'],['alpha','A–Z']].map(([id,l])=>(
        <button key={id} onClick={()=>set(id)} style={{padding:'4px 9px',borderRadius:6,fontSize:11,cursor:'pointer',fontFamily:'inherit',background:val===id?C.accent+'28':'transparent',color:val===id?C.accent:C.faint,border:`1px solid ${val===id?C.accent+'44':C.border}`}}>{l}</button>
      ))}
    </div>
  )

  const personRow=(p,i)=>(
    <div key={p.id} style={{display:'flex',gap:8,alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
      {pSort==='manual'&&<span style={{fontSize:14,color:C.faint,cursor:'grab',padding:'0 4px'}}>⠿</span>}
      <span style={{flex:1,fontSize:14}}>{p.name}</span>
      {data.families.length>0&&(
        <select value={p.familyId||''} onChange={e=>assignFam(p.id,e.target.value)} style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'4px 8px',fontSize:12,color:p.familyId?C.text:C.muted,fontFamily:'inherit'}}>
          <option value=''>Keine Familie</option>
          {data.families.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      )}
      <Btn onClick={()=>removePerson(p.id)} variant='danger' small>×</Btn>
    </div>
  )
  const familyRow=(f,i)=>(
    <div key={f.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'7px 0',borderBottom:`1px solid ${C.border}`}}>
      {fSort==='manual'&&<span style={{fontSize:14,color:C.faint,cursor:'grab',padding:'0 4px 0 0'}}>⠿</span>}
      <span style={{flex:1,fontSize:14}}>{f.name}</span>
      <div style={{display:'flex',gap:8,alignItems:'center'}}>
        <span style={{fontSize:12,color:C.faint}}>{data.people.filter(p=>p.familyId===f.id).length} Mitglieder</span>
        <Btn onClick={()=>removeFamily(f.id)} variant='danger' small>Entfernen</Btn>
      </div>
    </div>
  )

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <Toast msg={msg}/>
      <Card>
        <SecTitle>Reisename</SecTitle>
        {!canEdit&&<div style={{fontSize:12,color:C.orange,marginBottom:8}}>⚠ Bitte zuerst „Wer bist du?" auswählen, um den Namen zu ändern.</div>}
        <div style={{display:'flex',gap:8}}>
          <Input value={tripName} onChange={setTripName} placeholder='z.B. Gardasee 2025' style={{flex:1}} onKeyDown={e=>e.key==='Enter'&&saveName()}/>
          <Btn onClick={saveName} variant='primary' disabled={!canEdit}>Speichern</Btn>
        </div>
        {data.tripNameEditedBy&&<div style={{fontSize:11,color:C.faint,marginTop:6}}>Zuletzt geändert von <strong>{data.tripNameEditedBy}</strong>{data.tripNameEditedAt?' — '+new Date(data.tripNameEditedAt).toLocaleString('de-DE'):''}</div>}
      </Card>

      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <SecTitle style={{margin:0}}>Personen ({data.people.length})</SecTitle>
          <SortBtns val={pSort} set={setPSort}/>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <Input value={newP} onChange={setNewP} placeholder='Name hinzufügen…' style={{flex:1}} onKeyDown={e=>e.key==='Enter'&&addPerson()}/>
          <Btn onClick={addPerson} variant='primary'>Hinzufügen</Btn>
        </div>
        {!data.people.length&&<div style={{fontSize:13,color:C.faint}}>Noch keine Personen.</div>}
        {pSort==='manual'
          ? <DraggableList items={sortedPeople} onReorder={arr=>update(d=>({...d,people:arr}))} renderItem={personRow}/>
          : sortedPeople.map((p,i)=>personRow(p,i))
        }
      </Card>

      <Card>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
          <SecTitle style={{margin:0}}>Familiengruppen <span style={{color:C.faint,fontWeight:400,fontSize:10}}>— optional</span></SecTitle>
          <SortBtns val={fSort} set={setFSort}/>
        </div>
        <div style={{display:'flex',gap:8,marginBottom:10}}>
          <Input value={newF} onChange={setNewF} placeholder='z.B. Familie Müller' style={{flex:1}} onKeyDown={e=>e.key==='Enter'&&addFamily()}/>
          <Btn onClick={addFamily} variant='primary'>Hinzufügen</Btn>
        </div>
        {!data.families.length&&<div style={{fontSize:13,color:C.faint}}>Noch keine Gruppen.</div>}
        {fSort==='manual'
          ? <DraggableList items={sortedFamilies} onReorder={arr=>update(d=>({...d,families:arr}))} renderItem={familyRow}/>
          : sortedFamilies.map((f,i)=>familyRow(f,i))
        }
      </Card>
    </div>
  )
}

// ── Add Expense View ──────────────────────────────────────────────────────────
function AddView({data,update,currentUser}) {
  const [category,setCategory]=useState('dinner')
  const [msg,setMsg]=useState('')
  const flash=m=>{setMsg(m);setTimeout(()=>setMsg(''),3500)}

  // Shared event fields
  const [eName,setEName]=useState('')
  const [eDate,setEDate]=useState(today())
  const [eAtt,setEAtt]=useState([])

  // Grocery-specific
  const [gPayer,setGPayer]=useState('')
  const [gTotal,setGTotal]=useState('')
  const [gBens,setGBens]=useState([])

  // My order (add to existing)
  const [oEvt,setOEvt]=useState('')
  const [oPers,setOPers]=useState(currentUser?.id||'')
  const [oItems,setOItems]=useState([{id:uid(),name:'',price:''}])

  useEffect(()=>{if(currentUser)setOPers(currentUser.id)},[currentUser])

  const isGrocery=category==='grocery'

  // Check for same-day events
  const sameDayEvents=data.events.filter(e=>e.date===eDate&&e.category!=='grocery')

  const saveEvent=()=>{
    if(!eName||!eDate) return flash('Bitte Name und Datum eingeben.')
    if(isGrocery&&(!gPayer||!gTotal||!gBens.length)) return flash('Bitte Zahler, Betrag und Teilnehmer angeben.')
    const base={id:uid(),category,name:eName,date:eDate,payerIds:isGrocery?[gPayer]:[],attendeeIds:isGrocery?gBens:eAtt,tipAmount:0,tipInReceipt:false,noReceiptAvailable:false,lastEditedBy:currentUser?.name||'',lastEditedAt:new Date().toISOString()}
    const evt=isGrocery?{...base,total:parseFloat(gTotal)||0,beneficiaries:gBens}:base
    update(d=>({...d,events:[...d.events,evt]}))
    setEName('');setEAtt([]);setGTotal('');setGBens([]);setGPayer('')
    flash('✓ Gespeichert!')
  }

  const updOItem=(idx,f,v)=>setOItems(p=>p.map((it,i)=>i===idx?{...it,[f]:v}:it))
  const saveOrder=()=>{
    if(!oEvt||!oPers) return flash('Bitte Veranstaltung und Person auswählen.')
    const valid=oItems.filter(i=>i.name.trim()&&i.price!=='')
    if(!valid.length) return flash('Mindestens eine Position mit Name und Preis eingeben.')
    const parsed=valid.map(i=>({...i,price:parseFloat(i.price)||0}))
    update(d=>{
      const ex=d.entries.find(e=>e.eventId===oEvt&&e.personId===oPers)
      if(ex) return {...d,entries:d.entries.map(e=>e.id===ex.id?{...e,items:[...e.items,...parsed]}:e)}
      return {...d,entries:[...d.entries,{id:uid(),eventId:oEvt,personId:oPers,items:parsed}]}
    })
    setOItems([{id:uid(),name:'',price:''}]);flash('✓ Bestellung gespeichert!')
  }

  const nonGroceryEvents=data.events.filter(e=>e.category!=='grocery')

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* Category selector */}
      <Card>
        <SecTitle>Kategorie</SecTitle>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {CATEGORIES.map(cat=>(
            <button key={cat.id} onClick={()=>setCategory(cat.id)} style={{padding:'7px 16px',borderRadius:99,fontSize:13,fontWeight:500,cursor:'pointer',fontFamily:'inherit',background:category===cat.id?cat.color+'33':C.surface,color:category===cat.id?cat.color:C.muted,border:`1px solid ${category===cat.id?cat.color:C.border}`}}>{cat.de}</button>
          ))}
        </div>
      </Card>

      <Toast msg={msg}/>

      {/* Event creation form */}
      {category!=='add-order' && <>
        <Card>
          <SecTitle>{isGrocery?'Einkauf Details':'Veranstaltungsdetails'}</SecTitle>
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
            <div style={{flex:'2 1 180px'}}><Input label='Name' value={eName} onChange={setEName} placeholder={isGrocery?'z.B. Supermarkt':'z.B. Restaurant Bellavista'} onKeyDown={e=>e.key==='Enter'&&!isGrocery&&saveEvent()}/></div>
            <div style={{flex:'1 1 130px'}}><Input label='Datum' value={eDate} onChange={setEDate} type='date'/></div>
          </div>
          {isGrocery&&<div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <div style={{flex:'1 1 160px'}}><Sel label='Wer hat bezahlt?' value={gPayer} onChange={setGPayer} options={data.people.map(p=>({v:p.id,l:p.name}))}/></div>
            <div style={{flex:'1 1 110px'}}><Input label='Gesamt (€)' value={gTotal} onChange={setGTotal} type='number' placeholder='0,00'/></div>
          </div>}
        </Card>

        {sameDayEvents.length>0&&!isGrocery&&(
          <div style={{padding:'10px 14px',background:C.orange+'18',border:`1px solid ${C.orange}44`,borderRadius:10,fontSize:13,color:C.orange}}>
            ⚠ Es gibt bereits {sameDayEvents.length} Veranstaltung(en) für diesen Tag:
            {sameDayEvents.map(e=><div key={e.id} style={{fontWeight:500,marginTop:3}}>→ {e.name} ({catInfo(e.category).de})</div>)}
          </div>
        )}

        {isGrocery
          ? <Card><ChipSelect people={data.people} selected={gBens} onChange={setGBens} label='Aufgeteilt zwischen' color={C.green}/></Card>
          : <Card><ChipSelect people={data.people} selected={eAtt} onChange={setEAtt} label='Wer war dabei?'/><div style={{fontSize:12,color:C.faint,marginTop:8}}>Zahler und Trinkgeld können später beim Bearbeiten hinzugefügt werden.</div></Card>
        }

        <Btn onClick={saveEvent} variant='primary' full>{isGrocery?'Einkauf speichern':'Veranstaltung speichern'}</Btn>
      </>}

      {/* Add order to existing */}
      <Card>
        <SecTitle style={{marginBottom:8}}>Bestellung zu bestehender Veranstaltung hinzufügen</SecTitle>
        {!nonGroceryEvents.length
          ? <div style={{fontSize:13,color:C.faint}}>Noch keine Veranstaltungen.</div>
          : <>
            <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:12}}>
              <div style={{flex:'2 1 200px'}}><Sel label='Veranstaltung' value={oEvt} onChange={setOEvt} options={[...nonGroceryEvents].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>({v:e.id,l:`${e.name} (${e.date})`}))}/></div>
              <div style={{flex:'1 1 160px'}}><Sel label='Für wen?' value={oPers} onChange={setOPers} options={data.people.map(p=>({v:p.id,l:p.name}))}/></div>
            </div>
            {oItems.map((it,idx)=>(
              <div key={it.id} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-end'}}>
                <div style={{flex:3}}><Input value={it.name} onChange={v=>updOItem(idx,'name',v)} placeholder='Gericht / Getränk'/></div>
                <div style={{flex:1}}><Input value={it.price} onChange={v=>updOItem(idx,'price',v)} placeholder='€' type='number'/></div>
                <Btn onClick={()=>setOItems(p=>p.filter((_,i)=>i!==idx))} variant='danger' small>×</Btn>
              </div>
            ))}
            <Btn onClick={()=>setOItems(p=>[...p,{id:uid(),name:'',price:''}])} variant='ghost' small>+ Position</Btn>
            <div style={{marginTop:12}}><Btn onClick={saveOrder} variant='primary' full>Bestellung speichern</Btn></div>
          </>
        }
      </Card>

      {/* Existing events list */}
      {data.events.length>0&&(
        <Card>
          <SecTitle>Bestehende Ausgaben ({data.events.length})</SecTitle>
          {[...data.events].sort((a,b)=>b.date.localeCompare(a.date)).map(e=>{
            const cat=catInfo(e.category)
            return <div key={e.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'6px 0',borderBottom:`1px solid ${C.border}`,fontSize:13}}>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <Pill color={cat.color} small>{cat.de}</Pill>
                <span>{e.name}</span>
              </div>
              <span style={{color:C.muted,fontSize:12}}>{e.date}</span>
            </div>
          })}
        </Card>
      )}
    </div>
  )
}

// ── Edit Event Modal ──────────────────────────────────────────────────────────
function EditEventModal({evt,data,update,currentUser,onClose}) {
  const [name,setName]=useState(evt.name)
  const [date,setDate]=useState(evt.date)
  const [payers,setPayers]=useState(evt.payerIds||[])
  const [att,setAtt]=useState(evt.attendeeIds||[])
  const [bens,setBens]=useState(evt.beneficiaries||[])
  const [tip,setTip]=useState(evt.tipAmount?.toString()||'')
  const [tipIn,setTipIn]=useState(evt.tipInReceipt||false)
  const [noRcpt,setNoRcpt]=useState(evt.noReceiptAvailable||false)
  const [total,setTotal]=useState(evt.total?.toString()||'')

  const isGrocery=evt.category==='grocery'

  const save=()=>{
    update(d=>({...d,events:d.events.map(e=>e.id!==evt.id?e:{...e,name,date,payerIds:payers,attendeeIds:att,beneficiaries:bens,tipAmount:parseFloat(tip)||0,tipInReceipt:tipIn,noReceiptAvailable:noRcpt,total:parseFloat(total)||e.total||0,lastEditedBy:currentUser?.name||'Unbekannt',lastEditedAt:new Date().toISOString()})}))
    onClose()
  }

  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(520px,100%)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontSize:16,fontWeight:600,marginBottom:16}}>Bearbeiten: {evt.name}</div>
        <div style={{display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            <div style={{flex:'2 1 160px'}}><Input label='Name' value={name} onChange={setName}/></div>
            <div style={{flex:'1 1 130px'}}><Input label='Datum' value={date} onChange={setDate} type='date'/></div>
          </div>
          {isGrocery&&<Input label='Gesamt (€)' value={total} onChange={setTotal} type='number' placeholder='0,00'/>}
          <div>
            <label style={{fontSize:11,color:C.muted,textTransform:'uppercase',letterSpacing:'.06em',display:'block',marginBottom:8}}>Wer hat bezahlt?</label>
            <div style={{display:'flex',flexWrap:'wrap',gap:7}}>
              {data.people.map(p=>{const on=payers.includes(p.id);return<button key={p.id} onClick={()=>setPayers(prev=>on?prev.filter(x=>x!==p.id):[...prev,p.id])} style={{padding:'6px 14px',borderRadius:99,fontSize:13,cursor:'pointer',fontFamily:'inherit',background:on?C.green+'28':C.surface,color:on?C.green:C.muted,border:`1px solid ${on?C.green:C.border}`,fontWeight:on?600:400}}>{p.name}</button>})}
            </div>
          </div>
          {isGrocery
            ? <ChipSelect people={data.people} selected={bens} onChange={setBens} label='Aufgeteilt zwischen' color={C.green}/>
            : <>
              <ChipSelect people={data.people} selected={att} onChange={setAtt} label='Wer war dabei?'/>
              <div style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'center'}}>
                <div style={{flex:'0 0 150px'}}><Input label='Trinkgeld (€)' value={tip} onChange={setTip} type='number' placeholder='0,00'/></div>
                <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13,color:C.muted,marginTop:18,cursor:'pointer'}}>
                  <input type='checkbox' checked={tipIn} onChange={e=>setTipIn(e.target.checked)}/>Im Quittungsbetrag enthalten
                </label>
              </div>
            </>
          }
          <label style={{display:'flex',gap:8,alignItems:'center',fontSize:13,color:C.muted,cursor:'pointer',padding:'8px 12px',background:noRcpt?C.green+'15':C.surface,borderRadius:8,border:`1px solid ${noRcpt?C.green+'44':C.border}`}}>
            <input type='checkbox' checked={noRcpt} onChange={e=>setNoRcpt(e.target.checked)}/>
            <span>Kein Beleg verfügbar — Status trotzdem auf <strong>Abgeschlossen</strong> setzen</span>
          </label>
          {evt.lastEditedBy&&<div style={{fontSize:11,color:C.faint}}>Zuletzt bearbeitet von <strong>{evt.lastEditedBy}</strong>{evt.lastEditedAt?' — '+new Date(evt.lastEditedAt).toLocaleString('de-DE'):''}</div>}
          <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
            <Btn onClick={onClose} variant='ghost'>Abbrechen</Btn>
            <Btn onClick={save} variant='primary'>Speichern</Btn>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Edit Item Modal ───────────────────────────────────────────────────────────
function EditItemModal({entry,pName,update,onClose}) {
  const [items,setItems]=useState(entry.items.map(i=>({...i})))
  const upd=(idx,f,v)=>setItems(p=>p.map((it,i)=>i===idx?{...it,[f]:v}:it))
  const save=()=>{update(d=>({...d,entries:d.entries.map(e=>e.id!==entry.id?e:{...e,items:items.filter(i=>i.name.trim()).map(i=>({...i,price:parseFloat(i.price)||0}))})}));onClose()}
  return (
    <div onClick={onClose} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(480px,100%)',maxHeight:'90vh',overflowY:'auto'}}>
        <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>Bestellung bearbeiten</div>
        <div style={{fontSize:13,color:C.muted,marginBottom:14}}>{pName}</div>
        {items.map((it,idx)=>(
          <div key={it.id||idx} style={{display:'flex',gap:8,marginBottom:8,alignItems:'flex-end'}}>
            <div style={{flex:3}}><Input value={it.name} onChange={v=>upd(idx,'name',v)} placeholder='Gericht'/></div>
            <div style={{flex:1}}><Input value={it.price?.toString()||''} onChange={v=>upd(idx,'price',v)} placeholder='€' type='number'/></div>
            <Btn onClick={()=>setItems(p=>p.filter((_,i)=>i!==idx))} variant='danger' small>×</Btn>
          </div>
        ))}
        <Btn onClick={()=>setItems(p=>[...p,{id:uid(),name:'',price:''}])} variant='ghost' small style={{marginBottom:16}}>+ Position</Btn>
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <Btn onClick={onClose} variant='ghost'>Abbrechen</Btn>
          <Btn onClick={save} variant='primary'>Speichern</Btn>
        </div>
      </div>
    </div>
  )
}

// ── Receipt View ──────────────────────────────────────────────────────────────
function ReceiptView({data,update,currentUser}) {
  const [evtId,setEvtId]=useState('')
  const [scanning,setScanning]=useState(false)
  const [scanMsg,setScanMsg]=useState('')
  const [debugInfo,setDebugInfo]=useState('')

  const pName=id=>data.people.find(p=>p.id===id)?.name||'?'
  const sortedEvents=[...data.events].filter(e=>e.category!=='grocery').sort((a,b)=>b.date.localeCompare(a.date))
  const evtEntries=data.entries.filter(e=>e.eventId===evtId)
  const evtLines=data.receiptLines.filter(l=>l.eventId===evtId)
  const allItems=evtEntries.flatMap(en=>en.items.map(it=>({...it,personId:en.personId})))
  const noEntriesYet=evtEntries.length===0

  async function handleFile(file) {
    if(!evtId){setScanMsg('Zuerst eine Veranstaltung auswählen.');return}
    setScanning(true);setScanMsg('');setDebugInfo('')
    try {
      const f=await normaliseImage(file)
      const b64=await toBase64(f)
      const res=await fetch('/api/scan-receipt',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({imageContent:{type:'image',source:{type:'base64',media_type:f.type||'image/jpeg',data:b64}}})
      })
      const d=await res.json()
      if(d._debug){setDebugInfo(`Debug: ${JSON.stringify(d._debug).slice(0,200)}`)}
      if(!res.ok){setScanMsg(`Serverfehler: ${d.error||res.status}`);setScanning(false);return}
      const items=d.items||[]
      if(!items.length){setScanMsg('Keine Positionen erkannt. Bitte Foto prüfen.');setScanning(false);return}

      const newLines=items.map(ri=>{
        const nl=ri.name.toLowerCase()
        const match=allItems.find(ei=>ei.name.toLowerCase().split(' ').some(w=>w.length>3&&nl.includes(w))||Math.abs(ei.price-ri.price)<0.06)
        return{id:uid(),eventId:evtId,name:ri.name,price:ri.price,qty:ri.qty||1,unitPrice:ri.qty>1?ri.price/ri.qty:ri.price,matchedPersonId:match?.personId||null,status:match?'matched':'unmatched',confirmed:false}
      })
      update(d=>({...d,receiptLines:[...d.receiptLines.filter(l=>l.eventId!==evtId),...newLines],events:d.events.map(e=>e.id===evtId?{...e,lastEditedBy:currentUser?.name||'',lastEditedAt:new Date().toISOString()}:e)}))
      const mc=newLines.filter(l=>l.status==='matched').length
      setScanMsg(`✓ ${items.length} Positionen gefunden — ${mc} zugeordnet, ${items.length-mc} noch offen.`)
    } catch(err){console.error(err);setScanMsg(`Fehler: ${err.message}`)}
    setScanning(false)
  }

  const reassign=(lid,pid)=>update(d=>({...d,receiptLines:d.receiptLines.map(l=>l.id===lid?{...l,matchedPersonId:pid||null,status:pid?'assigned':'unmatched',confirmed:false}:l)}))
  const confirmLine=lid=>update(d=>({...d,receiptLines:d.receiptLines.map(l=>l.id===lid?{...l,confirmed:true}:l)}))

  // Assign receipt line to person AND create entry if needed
  const assignAndCreate=(lid,pid)=>{
    reassign(lid,pid)
    if(pid&&noEntriesYet){
      const line=evtLines.find(l=>l.id===lid)||data.receiptLines.find(l=>l.id===lid)
      if(!line) return
      const item={id:uid(),name:line.name,price:line.price}
      update(d=>{
        const ex=d.entries.find(e=>e.eventId===evtId&&e.personId===pid)
        if(ex) return{...d,entries:d.entries.map(e=>e.id===ex.id?{...e,items:[...e.items,item]}:e)}
        return{...d,entries:[...d.entries,{id:uid(),eventId:evtId,personId:pid,items:[item]}]}
      })
    }
  }

  const matched=evtLines.filter(l=>l.status!=='unmatched')
  const unmatched=evtLines.filter(l=>l.status==='unmatched')
  const rcptTotal=evtLines.reduce((s,l)=>s+l.price,0)
  const loggedTotal=allItems.reduce((s,i)=>s+i.price,0)
  const unmatchAmt=unmatched.reduce((s,l)=>s+l.price,0)

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <Card>
        <SecTitle>Veranstaltung auswählen</SecTitle>
        <Sel value={evtId} onChange={setEvtId} options={sortedEvents.map(e=>({v:e.id,l:`${e.name} — ${e.date}`}))}/>
      </Card>
      {evtId&&<>
        {noEntriesYet&&evtLines.length===0&&<div style={{padding:'10px 14px',background:C.blue+'18',border:`1px solid ${C.blue}44`,borderRadius:10,fontSize:13,color:C.blue}}>ℹ Noch keine Bestellungen eingetragen. Nach dem Scan kannst du jede Position direkt einer Person zuordnen — die Einträge werden automatisch erstellt.</div>}
        <Card>
          <SecTitle>Quittungsfoto hochladen</SecTitle>
          <label style={{display:'block',border:`2px dashed ${C.border}`,borderRadius:10,padding:'2rem',textAlign:'center',cursor:'pointer'}}
            onMouseOver={e=>e.currentTarget.style.borderColor=C.accent} onMouseOut={e=>e.currentTarget.style.borderColor=C.border}
            onDragOver={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.accent}}
            onDrop={e=>{e.preventDefault();e.currentTarget.style.borderColor=C.border;handleFile(e.dataTransfer.files[0])}}>
            <div style={{fontSize:32,marginBottom:6}}>📄</div>
            <div style={{fontSize:14,color:C.muted}}>Klicken oder Foto hierher ziehen</div>
            <div style={{fontSize:12,color:C.faint,marginTop:4}}>Unterstützt JPG, PNG, HEIC (iPhone)</div>
            <input type='file' accept='image/*,.heic,.heif' style={{display:'none'}} onChange={e=>handleFile(e.target.files[0])}/>
          </label>
          {scanning&&<div style={{display:'flex',gap:10,alignItems:'center',marginTop:12,fontSize:13,color:C.muted}}><div style={{width:14,height:14,border:`2px solid ${C.border}`,borderTopColor:C.accent,borderRadius:'50%',animation:'spin .7s linear infinite'}}/>KI liest Quittung (claude-opus-4-5)…</div>}
          {scanMsg&&<div style={{marginTop:10,fontSize:13,color:scanMsg.startsWith('✓')?C.green:C.red}}>{scanMsg}</div>}
          {debugInfo&&<div style={{marginTop:6,fontSize:11,color:C.faint,wordBreak:'break-all'}}>{debugInfo}</div>}
        </Card>

        {evtLines.length>0&&<>
          <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
            {[{l:'Eingetragen',v:fmt(loggedTotal),c:C.accent},{l:'Quittung',v:fmt(rcptTotal),c:C.green},{l:'Offen',v:fmt(unmatchAmt),c:unmatched.length?C.red:C.faint}].map(s=>(
              <Card key={s.l} style={{flex:'1 1 100px'}}>
                <div style={{fontSize:11,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'.05em'}}>{s.l}</div>
                <div style={{fontSize:20,fontWeight:600,color:s.c}}>{s.v}</div>
              </Card>
            ))}
          </div>
          {unmatched.length>0&&(
            <Card highlight>
              <SecTitle>⚠ Noch zuzuordnen ({unmatched.length})</SecTitle>
              {unmatched.map(line=>(
                <div key={line.id} style={{marginBottom:8,padding:'10px 12px',background:C.orange+'15',borderRadius:8,border:`1px solid ${C.orange}33`}}>
                  <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                    <span style={{flex:2,fontSize:14}}>{line.name}{line.qty>1?` ×${line.qty}`:''}</span>
                    <span style={{fontSize:13,color:C.accent,fontWeight:600}}>{fmt(line.price)}</span>
                    {line.qty>1&&<span style={{fontSize:11,color:C.muted}}>{fmt(line.unitPrice)}/Stk</span>}
                    <select value={line.matchedPersonId||''} onChange={e=>assignAndCreate(line.id,e.target.value)}
                      style={{flex:1,minWidth:120,background:C.surface,border:`1px solid ${C.orange}55`,borderRadius:6,padding:'6px 8px',fontSize:13,color:line.matchedPersonId?C.text:C.muted,fontFamily:'inherit'}}>
                      <option value=''>Zuordnen…</option>
                      {data.people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
            </Card>
          )}
          <Card>
            <SecTitle>✓ Zugeordnet ({matched.length})</SecTitle>
            {!matched.length&&<div style={{fontSize:13,color:C.faint}}>Noch keine.</div>}
            {matched.map(line=>{
              const person=data.people.find(p=>p.id===line.matchedPersonId)
              return(
                <div key={line.id} style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,padding:'8px 12px',background:line.confirmed?C.green+'12':C.surface,borderRadius:8,border:`1px solid ${line.confirmed?C.green+'33':C.border}`}}>
                  <span style={{flex:2,fontSize:13}}>{line.name}{line.qty>1?` ×${line.qty}`:''}</span>
                  <span style={{fontSize:12,color:C.muted}}>{fmt(line.price)}</span>
                  <span style={{fontSize:12,color:C.green,flex:1}}>{person?.name||'—'}</span>
                  {!line.confirmed?<Btn onClick={()=>confirmLine(line.id)} variant='success' small>Bestätigen</Btn>:<span style={{fontSize:11,color:C.green}}>✓</span>}
                  <select value={line.matchedPersonId||''} onChange={e=>reassign(line.id,e.target.value)}
                    style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,padding:'3px 6px',fontSize:11,color:C.muted,fontFamily:'inherit'}}>
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

// ── Ausgaben View ─────────────────────────────────────────────────────────────
const SORT_MODES=[{id:'date_desc',l:'Datum ↓'},{id:'date_asc',l:'Datum ↑'},{id:'grouped',l:'Gruppiert'},{id:'kanban',l:'Kanban'},{id:'manual',l:'Manuell'}]

function AusgabenView({data,update,currentUser}) {
  const [sortMode,setSortMode]=useState('date_desc')
  const [expanded,setExpanded]=useState({})
  const [editEvt,setEditEvt]=useState(null)
  const [editEntry,setEditEntry]=useState(null)
  const [evtOrder,setEvtOrder]=useState(null)

  const pName=id=>data.people.find(p=>p.id===id)?.name||'?'
  const toggle=id=>setExpanded(prev=>({...prev,[id]:!prev[id]}))
  const delEvt=id=>{if(!confirm('Ausgabe löschen?'))return;update(d=>({...d,events:d.events.filter(e=>e.id!==id),entries:d.entries.filter(e=>e.eventId!==id),receiptLines:d.receiptLines.filter(l=>l.eventId!==id)}))}

  const getStatus=evt=>computeStatus(evt,data.entries,data.receiptLines)

  const ordered=evtOrder?evtOrder.map(id=>data.events.find(e=>e.id===id)).filter(Boolean):data.events

  const getSorted=()=>{
    if(sortMode==='manual') return ordered
    if(sortMode==='date_asc') return [...data.events].sort((a,b)=>a.date.localeCompare(b.date))
    if(sortMode==='date_desc') return [...data.events].sort((a,b)=>b.date.localeCompare(a.date))
    if(sortMode==='grouped'){
      const groups={}
      data.events.forEach(e=>{if(!groups[e.category])groups[e.category]=[];groups[e.category].push(e)})
      return Object.entries(groups).flatMap(([,evts])=>evts.sort((a,b)=>b.date.localeCompare(a.date)))
    }
    return data.events
  }

  const sorted=getSorted()

  function EventCard({evt,compact=false}) {
    const entries=data.entries.filter(e=>e.eventId===evt.id)
    const lines=data.receiptLines.filter(l=>l.eventId===evt.id)
    const loggedTotal=evt.category==='grocery'?evt.total||0:entries.reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0)
    const rcptTotal=lines.reduce((s,l)=>s+l.price,0)
    const unmatchAmt=lines.filter(l=>l.status==='unmatched').reduce((s,l)=>s+l.price,0)
    const tip=evt.tipAmount||0
    const status=getStatus(evt)
    const si=STATUS[status]||STATUS.neu
    const cat=catInfo(evt.category)
    const open=expanded[evt.id]
    const hasPayer=(evt.payerIds?.length||0)>0
    const hasReceipt=lines.length>0

    return (
      <Card key={evt.id} style={compact?{padding:'10px 14px'}:{}} color={cat.color}>
        <div style={{display:'flex',justifyContent:'space-between',gap:10,marginBottom:compact?4:8}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:4}}>
              <Pill color={cat.color} small>{cat.de}</Pill>
              <Pill color={si.color} small>{si.de}</Pill>
              {!hasPayer&&<Pill color={C.red} small>Kein Zahler</Pill>}
              {!hasReceipt&&!evt.noReceiptAvailable&&evt.category!=='grocery'&&<Pill color={C.faint} small>Kein Beleg</Pill>}
            </div>
            <div style={{fontWeight:600,fontSize:compact?13:15,marginBottom:2}}>{evt.name}</div>
            <div style={{fontSize:12,color:C.muted}}>{evt.date}{evt.payerIds?.length?` · ${evt.payerIds.map(pName).join(', ')}`:''}</div>
          </div>
          <div style={{textAlign:'right',flexShrink:0}}>
            <div style={{fontSize:compact?15:18,fontWeight:600,color:C.accent}}>{fmt(loggedTotal)}</div>
            {lines.length>0&&<div style={{fontSize:12,color:C.green}}>{fmt(rcptTotal)}</div>}
            {unmatchAmt>0&&<div style={{fontSize:11,color:C.red}}>{fmt(unmatchAmt)} offen</div>}
            {tip>0&&<div style={{fontSize:11,color:C.muted}}>+{fmt(tip)} TG</div>}
          </div>
        </div>

        {!compact&&evt.attendeeIds?.length>0&&<div style={{fontSize:12,color:C.muted,marginBottom:6}}>Teilnehmer: {evt.attendeeIds.map(pName).join(', ')}</div>}
        {!compact&&evt.category==='grocery'&&(evt.beneficiaries||[]).length>0&&<div style={{fontSize:12,color:C.muted,marginBottom:6}}>Aufgeteilt zwischen: {(evt.beneficiaries||[]).map(pName).join(', ')}</div>}

        {!compact&&open&&evt.category!=='grocery'&&(
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10,marginTop:4,marginBottom:8}}>
            {!entries.length?<div style={{fontSize:13,color:C.faint}}>Noch keine Bestellungen.</div>
              :entries.map(en=>(
                <div key={en.id} style={{marginBottom:8,padding:'8px 10px',background:C.surface,borderRadius:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:13,color:C.accent,fontWeight:500}}>{pName(en.personId)}</span>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <span style={{fontSize:12,color:C.muted}}>{fmt(en.items.reduce((s,i)=>s+i.price,0))}</span>
                      <Btn onClick={()=>setEditEntry(en)} variant='ghost' small>Bearbeiten</Btn>
                    </div>
                  </div>
                  {en.items.map((i,ii)=><div key={i.id||ii} style={{display:'flex',justifyContent:'space-between',fontSize:12,color:C.muted,paddingLeft:8}}><span>{i.name}</span><span>{fmt(i.price)}</span></div>)}
                </div>
              ))
            }
          </div>
        )}

        {!compact&&<div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:4}}>
          {evt.category!=='grocery'&&<Btn onClick={()=>toggle(evt.id)} variant='ghost' small>{open?'▲ Weniger':'▼ Details'}</Btn>}
          <Btn onClick={()=>{if(!currentUser){alert('Bitte zuerst „Wer bist du?" auswählen.');return};setEditEvt(evt)}} variant='default' small>Bearbeiten</Btn>
          <Btn onClick={()=>delEvt(evt.id)} variant='danger' small style={{marginLeft:'auto'}}>Löschen</Btn>
        </div>}
        {!compact&&evt.lastEditedBy&&<div style={{fontSize:11,color:C.faint,marginTop:6}}>Zuletzt bearbeitet von <strong>{evt.lastEditedBy}</strong></div>}
      </Card>
    )
  }

  if(!data.events.length) return <div style={{padding:'3rem',textAlign:'center',color:C.faint,fontSize:14}}>Noch keine Ausgaben.</div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
        {SORT_MODES.map(m=>(
          <button key={m.id} onClick={()=>setSortMode(m.id)} style={{padding:'6px 12px',borderRadius:8,fontSize:12,cursor:'pointer',fontFamily:'inherit',background:sortMode===m.id?C.accent+'28':C.surface,color:sortMode===m.id?C.accent:C.muted,border:`1px solid ${sortMode===m.id?C.accent+'44':C.border}`}}>{m.l}</button>
        ))}
      </div>

      {sortMode==='kanban'?(
        <div style={{display:'flex',gap:10,overflowX:'auto',paddingBottom:8}}>
          {Object.entries(STATUS).map(([key,si])=>{
            const evts=data.events.filter(e=>getStatus(e)===key)
            return(
              <div key={key} style={{flex:'0 0 220px',minWidth:220}}>
                <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,padding:'6px 8px',background:si.color+'22',borderRadius:8}}>
                  <span style={{width:8,height:8,borderRadius:'50%',background:si.color,flexShrink:0}}/>
                  <span style={{fontSize:12,fontWeight:600,color:si.color}}>{si.de}</span>
                  <span style={{fontSize:11,color:C.muted,marginLeft:'auto'}}>{evts.length}</span>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {!evts.length&&<div style={{fontSize:12,color:C.faint,textAlign:'center',padding:'16px 0'}}>Leer</div>}
                  {evts.sort((a,b)=>b.date.localeCompare(a.date)).map(evt=><EventCard key={evt.id} evt={evt} compact/>)}
                </div>
              </div>
            )
          })}
        </div>
      ):sortMode==='grouped'?(
        Object.entries(
          sorted.reduce((acc,e)=>{if(!acc[e.category])acc[e.category]=[];acc[e.category].push(e);return acc},{})
        ).map(([cat,evts])=>(
          <div key={cat}>
            <div style={{fontSize:12,color:catInfo(cat).color,fontWeight:600,textTransform:'uppercase',letterSpacing:'.08em',marginBottom:8,marginTop:8}}>{catInfo(cat).de} ({evts.length})</div>
            {evts.map(evt=><EventCard key={evt.id} evt={evt}/>)}
          </div>
        ))
      ):sortMode==='manual'?(
        <DraggableList items={sorted} onReorder={arr=>{setEvtOrder(arr.map(e=>e.id));update(d=>({...d,events:arr}))}} renderItem={evt=><EventCard evt={evt}/>}/>
      ):(
        sorted.map(evt=><EventCard key={evt.id} evt={evt}/>)
      )}

      {editEvt&&<EditEventModal evt={editEvt} data={data} update={update} currentUser={currentUser} onClose={()=>setEditEvt(null)}/>}
      {editEntry&&<EditItemModal entry={editEntry} pName={pName(editEntry.personId)} update={update} onClose={()=>setEditEntry(null)}/>}
    </div>
  )
}

// ── Settle View ───────────────────────────────────────────────────────────────
function SettleView({data}) {
  const [drillPerson,setDrillPerson]=useState(null)
  const [drillType,setDrillType]=useState(null) // 'consumed'|'paid'

  const pName=id=>data.people.find(p=>p.id===id)?.name||'?'
  const fName=id=>data.families.find(f=>f.id===id)?.name
  const consumed={},paid={}
  data.people.forEach(p=>{consumed[p.id]=0;paid[p.id]=0})

  // Detailed breakdown for drill-down
  const consumedDetail={} // personId → [{eventName,date,items:[{name,price}],tipShare}]
  const paidDetail={}     // personId → [{eventName,date,amount}]
  data.people.forEach(p=>{consumedDetail[p.id]=[];paidDetail[p.id]=[]})

  data.events.forEach(evt=>{
    const cat=catInfo(evt.category)
    if(evt.category==='grocery'){
      const share=(evt.total||0)/Math.max(evt.beneficiaries?.length||1,1)
      ;(evt.beneficiaries||[]).forEach(pid=>{
        if(consumed[pid]!==undefined){
          consumed[pid]+=share
          consumedDetail[pid].push({eventName:evt.name,date:evt.date,category:cat.de,items:[{name:'Einkauf (anteilig)',price:share}],tipShare:0})
        }
      })
      const p=evt.payerIds?.[0]
      if(p&&paid[p]!==undefined){
        paid[p]+=evt.total||0
        paidDetail[p].push({eventName:evt.name,date:evt.date,category:cat.de,amount:evt.total||0})
      }
    } else {
      const tip=evt.tipAmount||0
      const diners=evt.attendeeIds?.length?evt.attendeeIds:data.entries.filter(e=>e.eventId===evt.id).map(e=>e.personId)
      const ents=data.entries.filter(e=>e.eventId===evt.id)
      ents.forEach(en=>{
        const sub=en.items.reduce((s,i)=>s+i.price,0)
        if(consumed[en.personId]!==undefined){
          const tipShare=diners.length?tip/diners.length:0
          consumed[en.personId]+=sub+tipShare
          consumedDetail[en.personId].push({eventName:evt.name,date:evt.date,category:cat.de,items:en.items,tipShare})
        }
      })
      const dTotal=ents.reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0)
      const pc=evt.payerIds?.length||0
      if(pc)evt.payerIds.forEach(pid=>{
        if(paid[pid]!==undefined){
          const amt=(dTotal+tip)/pc
          paid[pid]+=amt
          paidDetail[pid].push({eventName:evt.name,date:evt.date,category:cat.de,amount:amt})
        }
      })
    }
  })

  const bal={};data.people.forEach(p=>{bal[p.id]=paid[p.id]-consumed[p.id]})
  const debtors=data.people.filter(p=>bal[p.id]<-0.01).map(p=>({id:p.id,amt:-bal[p.id]}))
  const creditors=data.people.filter(p=>bal[p.id]>0.01).map(p=>({id:p.id,amt:bal[p.id]}))
  const txns=[];const D=debtors.map(x=>({...x})),CR=creditors.map(x=>({...x}))
  let di=0,ci=0
  while(di<D.length&&ci<CR.length){const pay=Math.min(D[di].amt,CR[ci].amt);if(pay>0.01)txns.push({from:D[di].id,to:CR[ci].id,amt:pay});D[di].amt-=pay;CR[ci].amt-=pay;if(D[di].amt<0.01)di++;if(CR[ci].amt<0.01)ci++}

  const famT=data.families.map(f=>{const m=data.people.filter(p=>p.familyId===f.id);return{...f,consumed:m.reduce((s,p)=>s+consumed[p.id],0),paid:m.reduce((s,p)=>s+paid[p.id],0),balance:m.reduce((s,p)=>s+bal[p.id],0)}})
  const grand=data.people.reduce((s,p)=>s+consumed[p.id],0)
  const bc=b=>b>0.01?C.green:b<-0.01?C.red:C.muted

  // Check for events missing payer
  const missingPayer=data.events.filter(e=>!e.payerIds?.length&&e.category!=='grocery')
  const missingTip=data.events.filter(e=>e.category!=='grocery'&&!e.tipAmount&&e.tipAmount!==0)

  function exportCSV(){
    const rows=[['Name','Familie','Verbraucht (€)','Bezahlt (€)','Saldo (€)']]
    data.people.forEach(p=>rows.push([p.name,fName(p.familyId)||'',consumed[p.id].toFixed(2),paid[p.id].toFixed(2),bal[p.id].toFixed(2)]))
    rows.push([],['AUSGABEN'],['Typ','Datum','Name','Bezahlt von','Gesamt (€)','Trinkgeld (€)'])
    data.events.forEach(e=>{const t=e.category==='grocery'?e.total||0:data.entries.filter(en=>en.eventId===e.id).reduce((s,en)=>s+en.items.reduce((ss,i)=>ss+i.price,0),0);rows.push([catInfo(e.category).de,e.date,e.name,(e.payerIds||[]).map(pName).join(' + '),t.toFixed(2),(e.tipAmount||0).toFixed(2)])})
    rows.push([],['ZAHLUNGEN'],['Von','','An','Betrag (€)'])
    txns.forEach(t=>rows.push([pName(t.from),'→',pName(t.to),t.amt.toFixed(2)]))
    const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\r\n')
    const blob=new Blob([csv],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${data.tripName.replace(/\s+/g,'_')}_Abrechnung.csv`;a.click();URL.revokeObjectURL(url)
  }

  // Drill-down modal
  function DrillModal() {
    if(!drillPerson||!drillType) return null
    const p=data.people.find(x=>x.id===drillPerson)
    const details=drillType==='consumed'?consumedDetail[drillPerson]:paidDetail[drillPerson]
    return(
      <div onClick={()=>setDrillPerson(null)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:200,padding:16}}>
        <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(520px,100%)',maxHeight:'85vh',overflowY:'auto'}}>
          <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>{p?.name} — {drillType==='consumed'?'Verbraucht':'Bezahlt'}</div>
          <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Gesamt: <strong style={{color:C.accent}}>{drillType==='consumed'?fmt(consumed[drillPerson]):fmt(paid[drillPerson])}</strong></div>
          {!details.length&&<div style={{fontSize:13,color:C.faint}}>Keine Einträge.</div>}
          {details.map((d,i)=>(
            <div key={i} style={{marginBottom:12,paddingBottom:12,borderBottom:`1px solid ${C.border}`}}>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
                <span style={{fontWeight:500,fontSize:14}}>{d.eventName}</span>
                <span style={{fontSize:13,color:C.muted}}>{d.date}</span>
              </div>
              <div style={{fontSize:12,color:C.muted,marginBottom:4}}>{d.category}</div>
              {drillType==='consumed'&&d.items?.map((it,ii)=>(
                <div key={ii} style={{display:'flex',justifyContent:'space-between',fontSize:13,paddingLeft:8,paddingBottom:2}}>
                  <span>{it.name}</span><span style={{color:C.accent}}>{fmt(it.price)}</span>
                </div>
              ))}
              {drillType==='consumed'&&d.tipShare>0.01&&(
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12,paddingLeft:8,color:C.muted}}>
                  <span>Trinkgeld (anteilig)</span><span>{fmt(d.tipShare)}</span>
                </div>
              )}
              {drillType==='paid'&&<div style={{display:'flex',justifyContent:'space-between',fontSize:13,paddingLeft:8}}><span>Bezahlt</span><span style={{color:C.green}}>{fmt(d.amount)}</span></div>}
            </div>
          ))}
          <Btn onClick={()=>setDrillPerson(null)} variant='ghost' full style={{marginTop:8}}>Schließen</Btn>
        </div>
      </div>
    )
  }

  return(
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {missingPayer.length>0&&(
        <div style={{padding:'10px 14px',background:C.red+'18',border:`1px solid ${C.red}44`,borderRadius:10,fontSize:13,color:C.red}}>
          ⚠ Kein Zahler eingetragen: {missingPayer.map(e=>e.name).join(', ')}
        </div>
      )}

      <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
        {[{l:'Gesamtausgaben',v:fmt(grand)},{l:'Ausgaben',v:data.events.length},{l:'Ø pro Person',v:fmt(grand/Math.max(data.people.length,1))}].map(s=>(
          <Card key={s.l} style={{flex:'1 1 110px'}}>
            <div style={{fontSize:11,color:C.muted,marginBottom:4,textTransform:'uppercase',letterSpacing:'.06em'}}>{s.l}</div>
            <div style={{fontSize:22,fontWeight:600,color:C.accent}}>{s.v}</div>
          </Card>
        ))}
      </div>

      <Card>
        <SecTitle>Übersicht pro Person</SecTitle>
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
            <thead><tr style={{borderBottom:`1px solid ${C.border}`}}>
              {['Name','Familie','Verbraucht','Bezahlt','Saldo'].map(h=><th key={h} style={{textAlign:'left',padding:'6px 8px',color:C.muted,fontWeight:500,fontSize:11,textTransform:'uppercase',letterSpacing:'.04em',whiteSpace:'nowrap'}}>{h}</th>)}
            </tr></thead>
            <tbody>{data.people.map(p=>(
              <tr key={p.id} style={{borderBottom:`1px solid ${C.border}22`}}>
                <td style={{padding:'8px 8px',fontWeight:500}}>{p.name}</td>
                <td style={{padding:'8px 8px',color:C.muted,fontSize:12}}>{fName(p.familyId)||'—'}</td>
                <td style={{padding:'8px 8px'}}>
                  <button onClick={()=>{setDrillPerson(p.id);setDrillType('consumed')}} style={{background:'none',border:'none',color:C.accent,cursor:'pointer',fontFamily:'inherit',fontSize:13,textDecoration:'underline dotted',padding:0}}>{fmt(consumed[p.id])}</button>
                </td>
                <td style={{padding:'8px 8px'}}>
                  <button onClick={()=>{setDrillPerson(p.id);setDrillType('paid')}} style={{background:'none',border:'none',color:C.green,cursor:'pointer',fontFamily:'inherit',fontSize:13,textDecoration:'underline dotted',padding:0}}>{fmt(paid[p.id])}</button>
                </td>
                <td style={{padding:'8px 8px',fontWeight:600,color:bc(bal[p.id])}}>{bal[p.id]>0.01?'+':''}{fmt(bal[p.id])}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div style={{fontSize:11,color:C.faint,marginTop:8}}>Klicke auf Verbraucht oder Bezahlt für eine Aufschlüsselung.</div>
      </Card>

      {famT.length>0&&<Card><SecTitle>Familiengruppen</SecTitle>{famT.map(f=><div key={f.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 0',borderBottom:`1px solid ${C.border}`,flexWrap:'wrap',gap:8}}><span style={{fontWeight:500}}>{f.name}</span><div style={{display:'flex',gap:16,fontSize:13}}><span style={{color:C.muted}}>verbraucht {fmt(f.consumed)}</span><span style={{color:C.muted}}>bezahlt {fmt(f.paid)}</span><span style={{fontWeight:600,color:bc(f.balance)}}>{f.balance>0.01?'+':''}{fmt(f.balance)}</span></div></div>)}</Card>}

      <Card highlight>
        <SecTitle>Zahlungen</SecTitle>
        {!txns.length?<div style={{fontSize:13,color:C.green,padding:'6px 0'}}>Alles ausgeglichen — keine Zahlungen nötig! 🎉</div>
          :txns.map((t,i)=><div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'11px 0',borderBottom:`1px solid ${C.border}`}}><span style={{fontWeight:500,flex:1}}>{pName(t.from)}</span><span style={{color:C.faint,fontSize:13}}>zahlt</span><span style={{fontWeight:500,flex:1}}>{pName(t.to)}</span><span style={{color:C.accent,fontWeight:600,fontSize:16}}>{fmt(t.amt)}</span></div>)
        }
      </Card>

      <Btn onClick={exportCSV} variant='success' full>Gesamtübersicht als CSV exportieren ↓</Btn>
      <DrillModal/>
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [syncing,setSyncing]=useState(false)
  const [view,setView]=useState('setup')
  const [currUser,setCurrUser]=useState(null)
  const [showPicker,setShowPicker]=useState(false)
  const tripId=useRef(null)

  useEffect(()=>{
    let id=localStorage.getItem(TRIP_KEY);if(!id){id=uid();localStorage.setItem(TRIP_KEY,id)};tripId.current=id
    const saved=localStorage.getItem(USER_KEY);if(saved){try{setCurrUser(JSON.parse(saved))}catch{}}
    loadAppData(id).then(d=>{setData(d||INIT);setLoading(false)}).catch(()=>{setData(INIT);setLoading(false)})
  },[])

  useEffect(()=>{
    if(!tripId.current||loading)return
    const sub=subscribeToTrip(tripId.current,payload=>setData(payload))
    return()=>sub.unsubscribe()
  },[loading])

  const update=useCallback(fn=>{
    setData(prev=>{const next=fn(prev);setSyncing(true);saveAppData(tripId.current,next).catch(console.error).finally(()=>setSyncing(false));return next})
  },[])

  const selectUser=p=>{setCurrUser(p);localStorage.setItem(USER_KEY,JSON.stringify(p));setShowPicker(false)}

  if(loading)return<div style={{background:C.bg,minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',color:C.muted,fontSize:14}}>Wird geladen…</div>

  const VIEWS=[{id:'setup',l:'Einstellungen'},{id:'add',l:'Hinzufügen'},{id:'receipt',l:'Quittung'},{id:'ausgaben',l:'Ausgaben'},{id:'settle',l:'Abrechnung'}]

  return(
    <div style={{background:C.bg,minHeight:'100vh',color:C.text}}>
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'0 20px',position:'sticky',top:0,background:C.bg,zIndex:50}}>
        <div style={{maxWidth:760,margin:'0 auto',display:'flex',justifyContent:'space-between',alignItems:'center',height:54}}>
          <div style={{display:'flex',alignItems:'baseline',gap:10}}>
            <span style={{fontSize:17,fontWeight:600,color:C.accent}}>{data.tripName}</span>
            <span style={{fontSize:11,color:syncing?C.muted:C.faint}}>{syncing?'Speichern…':`#${tripId.current?.slice(0,6).toUpperCase()}`}</span>
          </div>
          <button onClick={()=>setShowPicker(true)} style={{display:'flex',alignItems:'center',gap:8,padding:'5px 14px',borderRadius:99,background:currUser?C.accent+'22':C.surface,border:`1px solid ${currUser?C.accent+'44':C.border}`,color:currUser?C.accent:C.muted,fontSize:13,cursor:'pointer',fontFamily:'inherit'}}>
            <span style={{width:7,height:7,borderRadius:'50%',background:currUser?C.accent:C.faint,flexShrink:0}}/>
            {currUser?currUser.name:'Wer bist du?'}
          </button>
        </div>
      </div>
      <div style={{borderBottom:`1px solid ${C.border}`,padding:'0 16px',overflowX:'auto'}}>
        <div style={{maxWidth:760,margin:'0 auto',display:'flex',whiteSpace:'nowrap'}}>
          {VIEWS.map(v=><button key={v.id} onClick={()=>setView(v.id)} style={{padding:'11px 12px',fontSize:13,background:'transparent',border:'none',borderBottom:`2px solid ${view===v.id?C.accent:'transparent'}`,color:view===v.id?C.accent:C.muted,cursor:'pointer',fontFamily:'inherit',fontWeight:view===v.id?500:400}}>{v.l}</button>)}
        </div>
      </div>
      <div style={{maxWidth:760,margin:'0 auto',padding:'20px 16px 80px'}}>
        {view==='setup'   &&<SetupView    data={data} update={update} currentUser={currUser}/>}
        {view==='add'     &&<AddView      data={data} update={update} currentUser={currUser}/>}
        {view==='receipt' &&<ReceiptView  data={data} update={update} currentUser={currUser}/>}
        {view==='ausgaben'&&<AusgabenView data={data} update={update} currentUser={currUser}/>}
        {view==='settle'  &&<SettleView   data={data}/>}
      </div>
      {showPicker&&(
        <div onClick={()=>setShowPicker(false)} style={{position:'fixed',inset:0,background:'rgba(0,0,0,.78)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}}>
          <div onClick={e=>e.stopPropagation()} style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:24,width:'min(400px,92vw)',maxHeight:'80vh',overflowY:'auto'}}>
            <div style={{fontSize:16,fontWeight:600,marginBottom:4}}>Wer bist du?</div>
            <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Dein Name wird auf diesem Gerät gespeichert.</div>
            {!data.people.length&&<div style={{fontSize:13,color:C.faint}}>Zuerst Personen unter „Einstellungen" hinzufügen.</div>}
            {data.people.map(p=>(
              <button key={p.id} onClick={()=>selectUser(p)} style={{display:'block',width:'100%',textAlign:'left',padding:'11px 14px',marginBottom:6,borderRadius:8,border:`1px solid ${currUser?.id===p.id?C.accent:C.border}`,background:currUser?.id===p.id?C.accent+'22':C.surface,color:C.text,fontSize:14,cursor:'pointer',fontFamily:'inherit',fontWeight:currUser?.id===p.id?600:400}}>
                {currUser?.id===p.id?'✓ ':''}{p.name}
                {data.families.find(f=>f.id===p.familyId)&&<span style={{fontSize:12,color:C.muted,marginLeft:8}}>{data.families.find(f=>f.id===p.familyId)?.name}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
