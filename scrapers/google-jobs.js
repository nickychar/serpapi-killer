const puppeteer = require('puppeteer-extra')
const StealthPlugin = require('puppeteer-extra-plugin-stealth')
puppeteer.use(StealthPlugin())

// Map country codes / names to Google domain + locale
const COUNTRY_CONFIG = {
  nl: { domain: 'https://www.google.nl', hl: 'nl', gl: 'nl' },
  netherlands: { domain: 'https://www.google.nl', hl: 'nl', gl: 'nl' },
  de: { domain: 'https://www.google.de', hl: 'de', gl: 'de' },
  germany: { domain: 'https://www.google.de', hl: 'de', gl: 'de' },
  uk: { domain: 'https://www.google.co.uk', hl: 'en', gl: 'gb' },
  gb: { domain: 'https://www.google.co.uk', hl: 'en', gl: 'gb' },
  fr: { domain: 'https://www.google.fr', hl: 'fr', gl: 'fr' },
  france: { domain: 'https://www.google.fr', hl: 'fr', gl: 'fr' },
  be: { domain: 'https://www.google.be', hl: 'nl', gl: 'be' },
  belgium: { domain: 'https://www.google.be', hl: 'nl', gl: 'be' },
  es: { domain: 'https://www.google.es', hl: 'es', gl: 'es' },
  spain: { domain: 'https://www.google.es', hl: 'es', gl: 'es' },
  it: { domain: 'https://www.google.it', hl: 'it', gl: 'it' },
  italy: { domain: 'https://www.google.it', hl: 'it', gl: 'it' },
  pl: { domain: 'https://www.google.pl', hl: 'pl', gl: 'pl' },
  poland: { domain: 'https://www.google.pl', hl: 'pl', gl: 'pl' },
  us: { domain: 'https://www.google.com', hl: 'en', gl: 'us' },
}

const DEFAULT_COUNTRY = process.env.DEFAULT_COUNTRY || 'nl'

function getCountryConfig(location = '') {
  const loc = location.toLowerCase().trim()

  // Check if location matches a known country key
  for (const [key, config] of Object.entries(COUNTRY_CONFIG)) {
    if (loc === key || loc.endsWith(`, ${key}`) || loc.endsWith(` ${key}`)) {
      return config
    }
  }

  // Default to configured country
  return COUNTRY_CONFIG[DEFAULT_COUNTRY] || COUNTRY_CONFIG.nl
}

async function scrapeGoogleJobs(query, location = '', num = 10) {
  const countryConfig = getCountryConfig(location)
  const searchQuery = location ? `${query} ${location}` : query
  const url = `${countryConfig.domain}/search?q=${encodeURIComponent(searchQuery)}&ibp=htl;jobs&hl=${countryConfig.hl}&gl=${countryConfig.gl}&num=${num}`

  const launchOptions = {
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
  // Use system Chromium when running in Docker/Railway
  if (process.env.PUPPETEER_EXECUTABLE_PATH) {
    launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  }

  const browser = await puppeteer.launch(launchOptions)

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 1366, height: 900 })
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )

    // Block images/fonts/media to speed things up
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      if (['image', 'font', 'media', 'stylesheet'].includes(req.resourceType())) {
        req.abort()
      } else {
        req.continue()
      }
    })

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })

    // Dismiss EU cookie consent banners — clicking causes a reload so we
    // handle navigation and wait for it to settle before scraping.
    const cookieSelectors = [
      'button[aria-label*="Accept"]',
      'button[aria-label*="Accepteren"]',
      'button[aria-label*="Akzeptieren"]',
      'button[aria-label*="Accepter"]',
      '#L2AGLb',   // Google's "Accept all" button id
    ]
    for (const sel of cookieSelectors) {
      const btn = await page.$(sel)
      if (btn) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => {}),
          btn.click(),
        ])
        break
      }
    }

    // Wait for dynamic job content to render
    await new Promise((r) => setTimeout(r, 2500))

    const jobs = await page.evaluate((maxNum) => {
      const results = []

      // Try multiple known job card selectors — Google rotates class names
      const cardSelectors = [
        'li.iFjolb',
        'li[data-cjid]',
        '.PwjeAc li',
        'g-scrolling-carousel li',
        '[jsname="fEHEpb"]',
        '.nJXhWc',
        '.WpKAof li',
      ]

      let cards = []
      for (const sel of cardSelectors) {
        cards = [...document.querySelectorAll(sel)]
        if (cards.length > 0) break
      }

      // Helper: try multiple selectors and return first match text
      const getText = (el, sels) => {
        for (const s of sels) {
          const text = el.querySelector(s)?.textContent?.trim()
          if (text) return text
        }
        return ''
      }

      // Helper: get link from card
      const getLink = (el) => {
        const a = el.querySelector('a[href^="http"]') || el.querySelector('a[href^="/url"]')
        if (!a) return ''
        const href = a.getAttribute('href')
        if (!href) return ''
        if (href.startsWith('http')) return href
        // Decode Google redirect URLs
        const match = href.match(/[?&]q=([^&]+)/)
        if (match) return decodeURIComponent(match[1])
        return ''
      }

      for (const card of cards.slice(0, maxNum)) {
        const title = getText(card, [
          '.BjJfJf',
          'h3',
          '[role="heading"]',
          '.p1N2lc',
          '.r0bn4c',
          '.sH3zFd',
        ])

        const company = getText(card, [
          '.vNEEBe',
          '.B8cu5c',
          '.Q9PYT',
          '.waQ0qd',
          '.nJlQNd',
          '.MRLnJd',
        ])

        const location = getText(card, [
          '.Qk80Jf',
          '.KKh3md',
          '.GkXYNd',
          '.MRLnJd span:last-child',
          '.HBvzbc',
        ])

        const postedAt = getText(card, [
          '.LL4CDc span',
          '.SuWscb',
          '.PtODJe',
          'span[class*="ago"]',
          '[class*="posted"]',
        ])

        const scheduleType = getText(card, [
          '.HBvzbc',
          '.Gve2Ub',
          '.vjbqh',
          'span[class*="type"]',
          'span[class*="schedule"]',
          'span[class*="employment"]',
        ])

        // Description: grab all meaningful text from the card, strip the above fields
        const rawText = card.textContent?.trim() || ''
        const description = rawText
          .replace(title, '')
          .replace(company, '')
          .replace(location, '')
          .replace(postedAt, '')
          .replace(scheduleType, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 600)

        const link = getLink(card)

        if (title && company) {
          results.push({
            title,
            company_name: company,
            location,
            description,
            detected_extensions: {
              posted_at: postedAt,
              schedule_type: scheduleType,
            },
            related_links: link ? [{ link, text: 'Apply' }] : [],
          })
        }
      }

      return results
    }, num)

    return {
      search_metadata: {
        query,
        location,
        google_domain: countryConfig.domain,
        status: 'Success',
      },
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

module.exports = { scrapeGoogleJobs }
