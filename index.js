require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { scrapeGoogleJobs } = require('./scrapers/google-jobs')

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// Health check (JSON for API clients)
app.get('/status', (req, res) => {
  res.json({ status: 'SerpAPI Killer running', port: PORT })
})

// Drop-in replacement for https://serpapi.com/search
app.get('/search', async (req, res) => {
  const { engine, q, location, num, country } = req.query

  if (!q) {
    return res.status(400).json({ error: 'Missing required param: q' })
  }

  if (engine && engine !== 'google_jobs') {
    return res.status(400).json({ error: `Engine "${engine}" not supported. Only google_jobs is supported.` })
  }

  console.log(`[search] q="${q}" location="${location || ''}"`)

  try {
    const result = await scrapeGoogleJobs(q, location || country || '', parseInt(num) || 10)
    res.json(result)
  } catch (err) {
    console.error('[search] Error:', err.message)
    res.status(500).json({ error: err.message, jobs_results: [] })
  }
})

app.listen(PORT, () => {
  console.log(`SerpAPI Killer running at http://localhost:${PORT}`)
  console.log(`Default country: ${process.env.DEFAULT_COUNTRY || 'nl'} (Netherlands)`)
  console.log(`Drop-in endpoint: GET http://localhost:${PORT}/search?engine=google_jobs&q=...`)
})
