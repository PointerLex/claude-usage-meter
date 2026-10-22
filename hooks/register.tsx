import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Tokens } from '../types'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [] as Limit[])
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, { in: 0, out: 0 } as Tokens)

const CYAN = '#00f0ff'
const MAGENTA = '#ff00e6'
const HOT = '#ff2a6d'
const OFF = '#2b2b45'
const LABELS: Record<string, string> = { five_hour: '5H', seven_day: 'WEEK' }
const BAR = 12

// Hex color i/(n-1) of the way from `a` to `b`.
export const lerp = (a: string, b: string, i: number, n: number) => {
  const t = n > 1 ? i / (n - 1) : 0
  const ch = (s: string, o: number) => parseInt(s.slice(o, o + 2), 16)
  return (
    '#' +
    [1, 3, 5]
      .map(o => Math.round(ch(a, o) + (ch(b, o) - ch(a, o)) * t).toString(16).padStart(2, '0'))
      .join('')
  )
}

export const k = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

export const until = (iso: string | undefined, now: number) => {
  if (!iso) return ''
  const min = Math.max(0, Math.round((Date.parse(iso) - now) / 60000))
  return min >= 1440
    ? `${Math.floor(min / 1440)}d${Math.floor((min % 1440) / 60)}h`
    : `${Math.floor(min / 60)}h${min % 60}m`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('tokens')) as Tokens | undefined
    if (saved) await update($, tokens, () => saved)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (r.usage) {
      const u = r.usage
      // ponytail: read-add-write; two sessions finishing at the same instant can lose one turn
      const prev = ((await $.store.get('tokens')) as Tokens | undefined) ?? { in: 0, out: 0 }
      const total = {
        in: prev.in + u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens,
        out: prev.out + u.output_tokens,
      }
      await $.store.set('tokens', total)
      await update($, tokens, () => total)
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const lims = (await read($, limits)).filter(l => LABELS[l.kind])
    const tok = await read($, tokens)
    const now = await $.clock.now()
    const title = '▓▒░ USAGE ░▒▓'

    return (
      <Box flexDirection="row">
        <Text weight="bold">
          {[...title].map((c, i) => (
            <Text key={`t${i}`} color={lerp(CYAN, MAGENTA, i, title.length)}>
              {c}
            </Text>
          ))}
        </Text>
        {lims.map(l => {
          const left = Math.max(0, 100 - l.percentUsed)
          const filled = Math.round((left / 100) * BAR)
          return (
            <Text key={l.kind}>
              <Text color={MAGENTA}> │ </Text>
              <Text color={CYAN} weight="bold">{LABELS[l.kind]} </Text>
              {Array.from({ length: BAR }, (_, i) => (
                <Text key={`${l.kind}${i}`} color={i < filled ? lerp(CYAN, MAGENTA, i, BAR) : OFF}>
                  {i < filled ? '█' : '░'}
                </Text>
              ))}
              <Text color={left < 20 ? HOT : CYAN} weight="bold"> {left.toFixed(0)}%</Text>
              {l.resetsAt ? <Text dimColor> resets {until(l.resetsAt, now)}</Text> : null}
            </Text>
          )
        })}
        <Text color={MAGENTA}> │ </Text>
        <Text color={CYAN}>↑{k(tok.in)} </Text>
        <Text color={MAGENTA}>↓{k(tok.out)}</Text>
        <Text dimColor> TOK</Text>
      </Box>
    )
  })
}
