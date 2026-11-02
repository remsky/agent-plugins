import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

// thresholds from userConfig, set by register; defaults live in plugin.json
// ponytail: cache TTL is a setting, not read from the API. Subscriptions get 1h, API keys / usage overage get 5m.
let CACHE_TTL_MS = 0, CACHE_SHOW_MS = 0, REBUILT_TOKENS = 0, YELLOW_TOKENS = 0, RED_TOKENS = 0
const WARN_MS = 60_000

// main-thread request start: each request re-arms the cache TTL
const lastRequestAt = atom({ plugin: 'usage-band', key: 'lastRequestAt' } as const, null)
// cached tokens of the session's first response: system prompt, tools, first-message attachments
const baseline = atom({ plugin: 'usage-band', key: 'baseline' } as const, null)

// last main-thread response rewrote most of the prompt instead of reading it from cache
const rebuilt = atom({ plugin: 'usage-band', key: 'rebuilt' } as const, false)

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(n))

// whole minutes, seconds only in the final minute
const remaining = (ms: number) => (ms > 60_000 ? `${Math.ceil(ms / 60_000)}m` : `${Math.ceil(ms / 1000)}s`)

const until = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60)
  return d ? `${d}d${h}h` : h ? `${h}h${m % 60}m` : `${m}m`
}

// bar colors: 5h on top, weekly underneath
const C5H = 'suggestion', CWK = 'merged', TRACK = 'subtle'
const CELLS = 10

const filled = (r?: SessionRateLimit) => Math.min(CELLS, Math.max(0, Math.round(((r?.percentUsed ?? 0) / 100) * CELLS)))

// statusline.py's compact thresholds by default: consider compacting above 90K, compact when able above 130K
const heat = (tokens: number) => (tokens > RED_TOKENS ? 'error' : tokens > YELLOW_TOKENS ? 'warning' : 'success')

// first usage in the transcript, as statusline.py reads it
const firstCached = (jsonl: string) => {
  for (const line of jsonl.split('\n')) {
    try {
      const u = JSON.parse(line)?.message?.usage
      if (u) return (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
    } catch {}
  }
  return null
}

// the first step's own usage gives the split mid-turn; once per load the transcript corrects it,
// since a resumed session's first step reads the whole conversation from cache
let confirmed = false
const captureBaseline = async ($: EngineInterface, transcript: string) => {
  if (confirmed) return
  confirmed = true
  // ponytail: whole-file read rejects past 4 MiB, so a huge resumed transcript keeps the first-step value
  const found = firstCached(await $.fs.read(transcript))
  if (found) await update($, baseline, () => found)
}

export const register: Register = (on, options) => {
  const n = (key: string) => Number(options[key])
  CACHE_TTL_MS = n('cacheTtlMinutes') * 60_000
  CACHE_SHOW_MS = n('cacheShowMinutes') * 60_000
  REBUILT_TOKENS = n('rebuiltK') * 1000
  YELLOW_TOKENS = n('compactSoonK') * 1000
  RED_TOKENS = n('compactNowK') * 1000

  on('turn.step', async function* ($, e, next) {
    if (e.agentId) return yield* next(e)
    await update($, lastRequestAt, () => Date.now())
    const r = yield* next(e)
    const u = r.usage
    if (u) await update($, rebuilt, () => u.cache_creation_input_tokens > REBUILT_TOKENS && u.cache_creation_input_tokens > u.cache_read_input_tokens)
    if (u && (await read($, baseline)) === null) await update($, baseline, () => u.cache_creation_input_tokens + u.cache_read_input_tokens || null)
    return r
  })

  on('classic.Stop', async ($, e, next) => {
    await captureBaseline($, e.transcript_path)
    return next(e)
  })
    // a failed or slow read never holds up the turn's end
    .catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') { await update($, baseline, () => null); confirmed = false }
    return next(e)
  })

  on('session.start', async ($, e, next) => {
    let warned: number | null = null
    $.clock.every(1000, async () => {
      $.ui.invalidate('ui.render')
      const at = await read($, lastRequestAt)
      if (at === null || at === warned) return
      const left = at + CACHE_TTL_MS - Date.now()
      if (left > 0 && left <= WARN_MS) {
        warned = at
        $.ui.toast('Prompt cache goes cold in under a minute')
      }
    })
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const now = Date.now()
    const at = await read($, lastRequestAt)
    const base = await read($, baseline)
    const wasRebuilt = await read($, rebuilt)
    const { rateLimits, context } = await $.session.usage()
    const tokens = context.tokens ?? 0
    const left = at === null ? 0 : at + CACHE_TTL_MS - now
    const sep = <Text dimColor> │ </Text>
    const hour = rateLimits.find(r => r.kind === 'five_hour')
    const week = rateLimits.find(r => r.kind === 'seven_day')
    const top = filled(hour), bottom = filled(week)

    const segments = [
      tokens > 0 && [
        base && tokens > base ? <Text dimColor>({fmt(base)}) + </Text> : null,
        <Text color={heat(tokens)}>{fmt(base && tokens > base ? tokens - base : tokens)} tokens</Text>,
      ],
      (hour || week) && [
        <Text color={C5H}>5h</Text>,
        <Text dimColor>/</Text>,
        <Text color={CWK}>wk </Text>,
        // ▀ paints its top half in color, its bottom half in backgroundColor: two bars in one row
        Array.from({ length: CELLS }, (_, i) => (
          <Text color={i < top ? C5H : TRACK} backgroundColor={i < bottom ? CWK : TRACK}>▀</Text>
        )),
        hour?.resetsAt ? <Text dimColor> resets {until(Date.parse(hour.resetsAt) - now)}</Text> : null,
      ],
      wasRebuilt && <Text color="error">cache rebuilt</Text>,
      // quiet while actively working: only once the cache is under CACHE_SHOW_MS, or cold
      at !== null && left < CACHE_SHOW_MS && (
        left <= 0 ? <Text color="inactive">○ cache cold</Text>
        : (
          <Text color={left < 15 * 60_000 ? 'error' : left < 30 * 60_000 ? 'warning' : 'success'}>
            ● cache {remaining(left)}
          </Text>
        )
      ),
    ].filter(Boolean)

    return <Box marginTop={1}>{segments.map((s, i) => [i > 0 ? sep : null, s])}</Box>
  })
}
