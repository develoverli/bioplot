/**
 * Where the published app lives. Set this before submitting to the store.
 *
 * With an address the popup shows an "Open Bioplot" button, and the privacy and terms links
 * point at the pages it serves. Left empty, all three stay hidden, because a dead link is worse
 * than no link at all. The store listing carries the policy URL either way, and that is the
 * copy the reviewer reads.
 */
const SITE_URL = 'https://develoverli.github.io/bioplot'

const el = (id) => document.getElementById(id)

const site = SITE_URL.replace(/\/$/, '')

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
    text: 'Farm captured',
    hint: 'Open Bioplot and press Sync now.',
  }
}

function render() {
  const state = describe()
  el('state').className = state.tone
  el('stateText').textContent = state.text
  el('hint').textContent = state.hint
  el('dot').style.background =
    state.tone === 'ok' ? 'var(--accent)' : state.tone === 'warn' ? 'var(--warn)' : 'var(--bad)'

  const beds = (payload?.gardens ?? []).flatMap((garden) => garden.beds ?? [])
  el('seeds').textContent = payload ? String(payload.seeds.length) : '0'
  el('plots').textContent = String(beds.filter((bed) => !bed.isAnimal).length)
  el('animals').textContent = String(beds.filter((bed) => bed.isAnimal).length)

  el('last').textContent = captures.length
    ? `Last capture ${new Date(Math.max(...captures.map((capture) => capture.at))).toLocaleTimeString()}`
    : ''

  const hasAnything = captures.length > 0 || Object.keys(seen).length > 0
  const hasFarm = Boolean(payload) && (payload.seeds.length > 0 || payload.plots.length > 0)

  el('copy').disabled = !hasFarm
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

function copyCapture() {
  if (payload) copy(JSON.stringify(payload, null, 2), 'Capture')
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

el('primary').addEventListener('click', () => {
  if (site) chrome.tabs.create({ url: site })
})

el('copy').addEventListener('click', copyCapture)

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

// The open button and the policy links depend on the app having an address.
if (site) {
  el('actions').hidden = false
  el('privacyLink').href = `${site}/privacy.html`
  el('termsLink').href = `${site}/terms.html`
  el('privacyLink').hidden = false
  el('termsLink').hidden = false
}

el('version').textContent = `v${chrome.runtime.getManifest().version}`
