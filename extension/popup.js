/**
 * Where the published app lives. Set this before submitting to the store.
 *
 * The privacy policy and terms are pages of the app, so they only have an address once the app
 * has one. Left empty, the popup hides the row rather than shipping links that 404 — the store
 * listing carries the policy URL either way, and that is the copy the reviewer reads.
 */
const SITE_URL = ''

const el = (id) => document.getElementById(id)

let captures = []
let seen = {}
let payload = null

function status(message) {
  el('status').textContent = message
  window.setTimeout(() => {
    el('status').textContent = ''
  }, 2500)
}

/**
 * One line, one colour, one next step.
 *
 * Green means the app can plan with this. Amber means traffic was seen but the farm was not
 * opened yet. Red means nothing at all arrived, which is a different problem with a different
 * fix, so it must not look the same as amber.
 */
function describe() {
  const sawFarm = Object.keys(seen).some((url) => url.includes('/api/farm/user/'))

  if (captures.length === 0 && Object.keys(seen).length === 0) {
    return {
      tone: 'bad',
      text: 'Nothing captured',
      hint: 'Open chainers.io and reload the page. If this stays empty, reload the extension in chrome://extensions and reload the tab.',
    }
  }

  if (!payload || (payload.seeds.length === 0 && payload.plots.length === 0)) {
    return {
      tone: 'warn',
      text: sawFarm ? 'Farm seen, nothing recognised' : 'Waiting for your farm',
      hint: sawFarm
        ? 'The farm endpoints were captured but no rows were understood. Copy diagnostics and open an issue.'
        : 'Enter your farm inside chainers.io once, then reopen this popup.',
    }
  }

  return {
    tone: 'ok',
    text: 'Ready to sync',
    hint: 'Open bioplot and press Sync now.',
  }
}

function render() {
  const state = describe()
  el('state').className = state.tone
  el('stateText').textContent = state.text
  el('hint').textContent = state.hint

  const beds = (payload?.gardens ?? []).flatMap((garden) => garden.beds ?? [])
  el('seeds').textContent = payload ? String(payload.seeds.length) : '0'
  el('plots').textContent = String(beds.filter((bed) => !bed.isAnimal).length)
  el('animals').textContent = String(beds.filter((bed) => bed.isAnimal).length)

  el('last').textContent = captures.length
    ? new Date(Math.max(...captures.map((capture) => capture.at))).toLocaleTimeString()
    : '—'

  const hasAnything = captures.length > 0 || Object.keys(seen).length > 0
  el('copy').disabled = !payload || (payload.seeds.length === 0 && payload.plots.length === 0)
  el('copyDiag').disabled = !hasAnything
  el('copyRaw').disabled = captures.length === 0
  el('clear').disabled = !hasAnything
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text)
    status(`${label} copied.`)
  } catch {
    status('Clipboard blocked by the browser.')
  }
}

function load() {
  chrome.runtime.sendMessage({ type: 'get' }, (response) => {
    captures = Array.isArray(response?.captures) ? response.captures : []
    seen = response?.seen && typeof response.seen === 'object' ? response.seen : {}
    payload = captures.length ? globalThis.BioplotParse.toPayload(captures) : null
    render()
  })
}

load()

el('copy').addEventListener('click', () => {
  if (payload) copy(JSON.stringify(payload, null, 2), 'Capture')
})

el('copyDiag').addEventListener('click', () => {
  copy(JSON.stringify(globalThis.BioplotParse.buildDiagnostics(captures, seen), null, 2), 'Diagnostics')
})

el('copyRaw').addEventListener('click', () => {
  copy(JSON.stringify(captures, null, 2), 'Raw capture')
})

el('clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clear' }, () => {
    captures = []
    seen = {}
    payload = null
    render()
    status('Cleared. Reload chainers.io to capture again.')
  })
})

// Policy links, only once there is somewhere for them to point.
if (SITE_URL) {
  const site = SITE_URL.replace(/\/$/, '')
  el('privacyLink').href = `${site}/privacy.html`
  el('termsLink').href = `${site}/terms.html`
  el('links').hidden = false
}
