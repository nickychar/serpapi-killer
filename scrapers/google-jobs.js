const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

const COUNTRY_CONFIG = {
  nl: { base: 'https://nl.indeed.com', path: 'vacatures' },
  netherlands: { base: 'https://nl.indeed.com', path: 'vacatures' },
  de: { base: 'https://de.indeed.com', path: 'jobs' },
  germany: { base: 'https://de.indeed.com', path: 'jobs' },
  uk: { base: 'https://uk.indeed.com', path: 'jobs' },
  gb: { base: 'https://uk.indeed.com', path: 'jobs' },
  fr: { base: 'https://fr.indeed.com', path: 'emplois' },
  france: { base: 'https://fr.indeed.com', path: 'emplois' },
  be: { base: 'https://be.indeed.com', path: 'vacatures' },
  belgium: { base: 'https://be.indeed.com', path: 'vacatures' },
  es: { base: 'https://es.indeed.com', path: 'empleos' },
  it: { base: 'https://it.indeed.com', path: 'lavori' },
  us: { base: 'https://www.indeed.com', path: 'jobs' },
}

const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'nl'

function getConfig(location = '') {
  const loc = location.toLowerCase().trim()
  for (const [key, cfg] of Object.entries(COUNTRY_CONFIG)) {
    if (loc === key || loc.endsWith(`, ${key}`) || loc.endsWith(` ${key}`)) return cfg
  }
  return COUNTRY_CONFIG[DEFAULT_COUNTRY] || COUNTRY_CONFIG.nl
}

function getLaunchOptions() {
  const opts = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ],
  }
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    opts.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }
  return opts
}

async function scrapeJobs(query, location = '', num = 10) {
  const cfg = getConfig(location)
  const params = new URLSearchParams({ q: query, limit: num })
  if (location) params.set('l', location)
  const url = `${cfg.base}/${cfg.path}?${params}`

  const browser = await puppeteer.launch(getLaunchOptions())

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1366, height: 900 })
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )

    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (['image', 'font', 'media'].includes(req.resourceType())) req.abort()
      else req.continue()
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Dismiss cookie banner if present (no navigation — Indeed just hides it)
    await page.evaluate(() => {
      const btn = document.querySelector(
        '#onetrust-accept-btn-handler, button[id*="accept"], button[class*="accept-btn"]'
      )
      if (btn) btn.click()
    }).catch(() => {})

    await new Promise((r) => setTimeout(r, 1500))

    const jobs = await page.evaluate((maxNum, base) => {
      const results = []
      const cards = [...document.querySelectorAll('div.job_seen_beacon')].slice(0, maxNum)

      for (const card of cards) {
        // Title
        const titleEl = card.querySelector('h2.jobTitle a span[title], span[id^="jobTitle-"]')
        const title = titleEl?.getAttribute('title') || titleEl?.textContent?.trim() || ''

        // Company
        const company =
          card.querySelector('[data-testid="company-name"]')?.textContent?.trim() || ''

        // Location
        const location =
          card.querySelector('[data-testid="text-location"]')?.textContent?.trim() || ''

        // Schedule type — first attribute snippet (often Fulltime/Parttime)
        const scheduleEl = card.querySelector(
          'li[data-testid="attribute_snippet_testid"] span.css-zydy3i'
        )
        const scheduleType = scheduleEl?.textContent?.trim().replace(/\+\d+$/, '').trim() || ''

        // Snippet / description
        const snippet =
          card.querySelector('.job-snippet, [class*="snippet"], ul.jobCardShelfContainer')
            ?.textContent?.trim() || ''

        // Posted date
        const postedAt =
          card.querySelector('[class*="date"], span.date, .jobCardFooterItem')
            ?.textContent?.trim() || ''

        // Apply link — use the stable viewjob URL
        const jkAttr = card.querySelector('a[data-jk]')?.getAttribute('data-jk')
        const link = jkAttr ? `${base}/viewjob?jk=${jkAttr}` : ''

        if (title && company) {
          results.push({
            title,
            company_name: company,
            location,
            description: snippet,
            detected_extensions: {
              posted_at: postedAt,
              schedule_type: scheduleType,
            },
            related_links: link ? [{ link, text: 'Apply on Indeed' }] : [],
          })
        }
      }

      return results
    }, num, cfg.base)

    return {
      search_metadata: { query, location, source: cfg.base, status: jobs.length > 0 ? 'Success' : 'No results' },
      jobs_results: jobs,
    }
  } catch (err) {
    return {
      search_metadata: { query, location, status: 'Error' },
      error: err.message,
      jobs_results: [],
    }
  } finally {
    await browser.close()
  }
}

module.exports = { scrapeGoogleJobs: scrapeJobs }
