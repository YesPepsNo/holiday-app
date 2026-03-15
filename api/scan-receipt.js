export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })

  const imageContent = req.body.imageContent // { type:'image', source:{type:'base64', media_type, data} }
  if (!imageContent) return res.status(400).json({ error: 'Missing imageContent' })

  const makeRequest = async (systemPrompt) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: 'Extract all line items from this receipt.' }] }],
      }),
    })
    const d = await r.json()
    if (!r.ok) throw new Error(d.error?.message || `HTTP ${r.status}`)
    return (d.content || []).map(c => c.text || '').join('')
  }

  function tryParse(text) {
    if (!text) return null
    const strategies = [
      t => JSON.parse(t.trim()),
      t => JSON.parse(t.replace(/```[a-z]*\n?/gi, '').replace(/```/g, '').trim()),
      t => { const m = t.match(/\[[\s\S]*?\]/); return m ? JSON.parse(m[0]) : null },
      t => {
        const objs = [...t.matchAll(/\{[^{}]+\}/g)]
        const arr = objs.map(m => { try { return JSON.parse(m[0]) } catch { return null } }).filter(o => o?.name && o?.price !== undefined)
        return arr.length ? arr : null
      },
    ]
    for (const s of strategies) {
      try { const r = s(text); if (Array.isArray(r) && r.length > 0) return r } catch {}
    }
    return null
  }

  try {
    // Attempt 1: detailed system prompt
    const text1 = await makeRequest(
      `You are a receipt OCR parser. Extract every purchased line item from the receipt image.
Return ONLY a raw JSON array — no markdown, no explanation, no code fences.
Start your response with [ and end with ].
Each element: {"name": string, "price": number, "qty": number}
- price = total price for that line (not unit price)
- qty defaults to 1
- Skip subtotals, grand totals, taxes, tips, service charges
- Include drinks, food, and any other purchased items
Example: [{"name":"Schnitzel","price":16.50,"qty":1},{"name":"Bier 0.5l","price":3.80,"qty":2}]`
    )
    console.log('Attempt 1 raw (500):', text1.slice(0, 500))
    const items1 = tryParse(text1)
    if (items1) return res.status(200).json({ items: items1 })

    // Attempt 2: minimal prompt
    const text2 = await makeRequest(
      'List every item bought on this receipt as JSON array: [{"name":"...","price":0.00,"qty":1}]. Raw JSON only, no other text.'
    )
    console.log('Attempt 2 raw (300):', text2.slice(0, 300))
    const items2 = tryParse(text2)
    if (items2) return res.status(200).json({ items: items2 })

    // Both failed — return debug info
    console.error('Both attempts failed. Text1:', text1, 'Text2:', text2)
    return res.status(200).json({ items: [], _debug: { text1: text1.slice(0, 300), text2: text2.slice(0, 300) } })

  } catch (err) {
    console.error('scan-receipt error:', err)
    return res.status(500).json({ error: err.message })
  }
}
