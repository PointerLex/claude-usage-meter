import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Container, Ctx, Dev, GraphLine, Limit, Pr, Tokens } from '../types'

const limits = atom({ plugin: 'usage-meter', key: 'limits' } as const, [] as Limit[])
const tokens = atom({ plugin: 'usage-meter', key: 'tokens' } as const, { in: 0, out: 0 } as Tokens)
const ctx = atom({ plugin: 'usage-meter', key: 'ctx' } as const, { window: 0 } as Ctx)
const ctxHist = atom({ plugin: 'usage-meter', key: 'ctxHist' } as const, [] as number[])
const turnHist = atom({ plugin: 'usage-meter', key: 'turnHist' } as const, [] as number[])
const dev = atom({ plugin: 'usage-meter', key: 'dev' } as const, { ahead: 0, behind: 0, changes: 0, graph: [] } as Dev)

const PANE = 'usage-meter'
const CYAN = '#00f0ff'
const MAGENTA = '#ff00e6'
const HOT = '#ff2a6d'
const OFF = '#2b2b45'
const LABELS: Record<string, string> = { five_hour: '5H', seven_day: 'WEEK' }
const BAR = 12
const BG = '#000000'
const HIST = 200
const BLOCKS = '▁▂▃▄▅▆▇█'
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const LANES = [CYAN, MAGENTA, '#b967ff', '#05ffa1', '#fffb96']
const GREEN = '#05ffa1'
const SEP = '\x1f'

// `git status --porcelain=v2 --branch` -> branch, ahead/behind, changed paths.
export const parseStatus = (out: string) => {
  let branch: string | undefined
  let ahead = 0
  let behind = 0
  let changes = 0
  for (const l of out.split('\n')) {
    if (l.startsWith('# branch.head ')) branch = l.slice(14).trim()
    else if (l.startsWith('# branch.ab ')) {
      const [a, b] = l.slice(12).trim().split(' ')
      ahead = Math.abs(Number(a))
      behind = Math.abs(Number(b))
    } else if (l.trim() && !l.startsWith('#')) changes++
  }
  return { branch, ahead, behind, changes }
}

// `git log --graph --format=<SEP>%h<SEP>%d<SEP>%s` -> lines; graph-only lines have no hash.
export const parseGraph = (out: string): GraphLine[] =>
  out
    .split('\n')
    .filter(l => l.trim())
    .map(l => {
      const [graph = '', hash = '', refs = '', subject = ''] = l.split(SEP)
      return { graph, hash, refs: refs.trim(), subject }
    })

// `docker ps -a --format {{json .}}` -> containers.
export const parseDocker = (out: string): Container[] =>
  out
    .split('\n')
    .filter(l => l.trim().startsWith('{'))
    .map(l => {
      const j = JSON.parse(l) as Record<string, string>
      return { name: j.Names ?? '', image: j.Image ?? '', state: j.State ?? '', status: j.Status ?? '' }
    })

async function sh($: EngineInterface, argv: string[]) {
  try {
    const r = await $.process.run(argv, { timeoutMs: 8000 })
    return r.exitCode === 0 ? r.stdout : undefined
  } catch {
    return undefined
  }
}

async function refresh($: EngineInterface, hide: string[]) {
  const [status, log, prs, docker] = await Promise.all([
    sh($, ['git', 'status', '--porcelain=v2', '--branch']),
    sh($, ['git', 'log', '--graph', '--all', '-n', '20', '--decorate=short', `--format=${SEP}%h${SEP}%d${SEP}%s`]),
    sh($, ['gh', 'pr', 'list', '-L', '8', '--json', 'number,title,headRefName,isDraft']),
    sh($, ['docker', 'ps', '-a', '--format', '{{json .}}']),
  ])
  let prList: Pr[] | undefined
  try {
    prList = prs === undefined ? undefined : (JSON.parse(prs) as Pr[])
  } catch {
    prList = undefined
  }
  const next: Dev = {
    ...(status === undefined ? { ahead: 0, behind: 0, changes: 0 } : parseStatus(status)),
    graph: log === undefined ? [] : parseGraph(log),
    prs: prList,
    containers: docker === undefined ? undefined : parseDocker(docker).filter(c => !hide.some(h => c.name.includes(h))),
    dockerNote: docker === undefined ? 'Docker not reachable.' : undefined,
  }
  await update($, dev, () => next)
}

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

// `n` gradient cells, the first `pct`% lit.
export const cells = (pct: number, n: number) => {
  const lit = Math.round((Math.min(100, Math.max(0, pct)) / 100) * n)
  return Array.from({ length: n }, (_, i) =>
    i < lit ? { ch: '█', color: lerp(CYAN, MAGENTA, i, n) } : { ch: '░', color: OFF },
  )
}

export const b64 = (u8: Uint8Array) => {
  let s = ''
  for (let i = 0; i < u8.length; i += 3) {
    const a = u8[i] ?? 0
    const b = u8[i + 1]
    const c = u8[i + 2]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? '=' : B64[(n >> 6) & 63]!) + (c === undefined ? '=' : B64[n & 63]!)
  }
  return s
}

// Column chart as Raster cells: newest value at the right, eighth-block tops, cyan->magenta by height, black ground.
export const columnChart = (values: number[], cols: number, rows: number) => {
  const max = Math.max(1, ...values)
  const vs = values.slice(-cols)
  const off = cols - vs.length
  const w = new Uint32Array(cols * rows * 3)
  for (let x = 0; x < cols; x++) {
    const eighths = x < off ? 0 : Math.round(((vs[x - off] ?? 0) / max) * rows * 8)
    for (let r = 0; r < rows; r++) {
      const fill = Math.max(0, Math.min(8, eighths - r * 8))
      const i = ((rows - 1 - r) * cols + x) * 3
      w[i] = fill ? BLOCKS.charCodeAt(fill - 1) : 0x20
      w[i + 1] = parseInt(lerp(CYAN, MAGENTA, r, rows).slice(1), 16)
      w[i + 2] = 0
    }
  }
  return b64(new Uint8Array(w.buffer))
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

export const register: Register = (on, options) => {
  const hide = String(options.hideContainers ?? '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get('tokens')) as Tokens | undefined
    if (saved) await update($, tokens, () => saved)
    await $.command.register({ name: 'usage-meter', description: 'Open the usage and context pane' })
    void $.ui.open({ id: PANE, title: 'Usage' })
    void refresh($, hide)
    // ponytail: polls every 30s; a git/docker event stream if that ever feels stale
    $.clock.every(30_000, () => void refresh($, hide))
    return next(e)
  })

  on('command.run', { command: 'usage-meter' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Usage' })
    return { text: 'Usage pane opened.' }
  })

  on('session.measure', async ($, e, next) => {
    await update($, limits, () => e.rateLimits)
    await update($, ctx, () => ({ percent: e.context.percent, tokens: e.context.tokens, window: e.context.window }))
    const pct = e.context.percent
    if (pct !== undefined && e.changed.includes('context')) await update($, ctxHist, h => [...h, pct].slice(-HIST))
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
      await update($, turnHist, h => [...h, u.output_tokens].slice(-HIST))
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const lims = (await read($, limits)).filter(l => LABELS[l.kind])
    const tok = await read($, tokens)
    const c = await read($, ctx)
    const now = await $.clock.now()
    const title = '▓▒░ USAGE ░▒▓'

    return (
      <Box flexDirection="row">
        <Text weight="bold">
          {[...title].map((ch, i) => (
            <Text key={`t${i}`} color={lerp(CYAN, MAGENTA, i, title.length)}>
              {ch}
            </Text>
          ))}
        </Text>
        {lims.map(l => {
          const left = Math.max(0, 100 - l.percentUsed)
          return (
            <Text key={l.kind}>
              <Text color={MAGENTA}> │ </Text>
              <Text color={CYAN} weight="bold">{LABELS[l.kind]} </Text>
              {cells(left, BAR).map((x, i) => (
                <Text key={`${l.kind}${i}`} color={x.color}>{x.ch}</Text>
              ))}
              <Text color={left < 20 ? HOT : CYAN} weight="bold"> {left.toFixed(0)}% left</Text>
              {l.resetsAt ? <Text dimColor> resets {until(l.resetsAt, now)}</Text> : null}
            </Text>
          )
        })}
        {c.percent === undefined ? null : (
          <Text>
            <Text color={MAGENTA}> │ </Text>
            <Text color={CYAN} weight="bold">CTX </Text>
            {cells(c.percent, 8).map((x, i) => (
              <Text key={`c${i}`} color={x.color}>{x.ch}</Text>
            ))}
            <Text color={c.percent > 80 ? HOT : CYAN} weight="bold"> {c.percent}% used</Text>
          </Text>
        )}
        <Text color={MAGENTA}> │ </Text>
        <Text color={CYAN}>↑{k(tok.in)} </Text>
        <Text color={MAGENTA}>↓{k(tok.out)}</Text>
        <Text dimColor> TOK</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const Raster = e.surface === 'terminal' ? $.ui.resolve(e).Raster : undefined
    await read($, ctx) // redraw whenever the window moves
    const lims = (await read($, limits)).filter(l => LABELS[l.kind])
    const tok = await read($, tokens)
    const ch = await read($, ctxHist)
    const th = await read($, turnHist)
    const d = await read($, dev)
    const now = await $.clock.now()
    const b = (await $.session.usage({ breakdown: 'summary' })).context.breakdown
    const w = Math.max(10, e.props.bodyColumns - 2)

    return (
      <Box flexDirection="column" backgroundColor={BG} minHeight={e.props.scroll.bodyRows} paddingX={1}>
        <Text color={CYAN} weight="bold">CONTEXT</Text>
        {b ? (
          <Box flexDirection="column">
            <Text>
              <Text color={b.percentage > 80 ? HOT : MAGENTA} weight="bold">{b.percentage}% used </Text>
              <Text dimColor>{k(b.totalTokens)} / {k(b.rawMaxTokens)}</Text>
            </Text>
            <Text>
              {b.categories
                .filter(r => r.kind !== 'deferred' && r.tokens > 0)
                .map(r => (
                  <Text key={`s${r.name}`} color={r.kind === 'free' ? OFF : r.color}>
                    {(r.kind === 'free' ? '░' : '█').repeat(Math.round((r.tokens / b.rawMaxTokens) * w))}
                  </Text>
                ))}
            </Text>
            {b.categories
              .filter(r => r.tokens > 0)
              .map(r => (
                <Box key={`r${r.name}`} flexDirection="row" justifyContent="space-between">
                  <Text>
                    <Text color={r.kind === 'free' ? OFF : r.color}>■ </Text>
                    <Text dimColor={r.isDeferred}>{r.name}</Text>
                  </Text>
                  <Text dimColor={r.isDeferred}>
                    {k(r.tokens)}{' '}
                    {r.isDeferred ? '   —' : `${((r.tokens / b.rawMaxTokens) * 100).toFixed(1).padStart(5)}%`}
                  </Text>
                </Box>
              ))}
          </Box>
        ) : (
          <Text dimColor>No breakdown yet.</Text>
        )}
        <Text> </Text>
        <Text>
          <Text color={CYAN} weight="bold">CONTEXT HISTORY </Text>
          <Text dimColor>% used per reading</Text>
        </Text>
        {Raster && ch.length > 0 ? (
          <Raster key="ctx-hist" columns={w} rows={6} cells={columnChart(ch, w, 6)} />
        ) : (
          <Text dimColor>Fills in as the session runs.</Text>
        )}
        <Text> </Text>
        <Text>
          <Text color={CYAN} weight="bold">OUTPUT / TURN </Text>
          <Text dimColor>{th.length ? `max ${k(Math.max(...th))} · last ${k(th[th.length - 1] ?? 0)}` : ''}</Text>
        </Text>
        {Raster && th.length > 0 ? (
          <Raster key="turn-hist" columns={w} rows={6} cells={columnChart(th, w, 6)} />
        ) : (
          <Text dimColor>Fills in after each turn.</Text>
        )}
        <Text> </Text>
        <Text color={CYAN} weight="bold">LIMITS</Text>
        {lims.length === 0 ? <Text dimColor>After the first response (subscription only).</Text> : null}
        {lims.map(l => {
          const left = Math.max(0, 100 - l.percentUsed)
          return (
            <Text key={`p${l.kind}`}>
              <Text color={CYAN}>{(LABELS[l.kind] ?? '').padEnd(5)}</Text>
              {cells(left, BAR).map((x, i) => (
                <Text key={`p${l.kind}${i}`} color={x.color}>{x.ch}</Text>
              ))}
              <Text color={left < 20 ? HOT : CYAN}> {left.toFixed(0)}%</Text>
              {l.resetsAt ? <Text dimColor> {until(l.resetsAt, now)}</Text> : null}
            </Text>
          )
        })}
        <Text> </Text>
        <Text color={CYAN} weight="bold">TOKENS</Text>
        <Text>
          <Text color={CYAN}>↑{k(tok.in)} in  </Text>
          <Text color={MAGENTA}>↓{k(tok.out)} out</Text>
        </Text>
        <Text> </Text>
        <Text>
          <Text color={CYAN} weight="bold">GIT </Text>
          {d.branch ? (
            <Text>
              <Text color={MAGENTA}>{d.branch}</Text>
              <Text dimColor>
                {' '}↑{d.ahead} ↓{d.behind} · {d.changes} changed
              </Text>
            </Text>
          ) : (
            <Text dimColor>not a git repo</Text>
          )}
        </Text>
        {d.graph.map((g, i) => (
          <Text key={`g${i}`} wrap="truncate-end">
            {[...g.graph].map((c, j) => (
              <Text key={`g${i}c${j}`} color={c === '*' ? '#ffffff' : LANES[Math.floor(j / 2) % LANES.length]}>
                {c === '*' ? '●' : c}
              </Text>
            ))}
            {g.hash ? <Text color="#fffb96"> {g.hash}</Text> : null}
            {g.refs ? <Text color={MAGENTA}> {g.refs}</Text> : null}
            {g.subject ? <Text> {g.subject}</Text> : null}
          </Text>
        ))}
        <Text> </Text>
        <Text color={CYAN} weight="bold">PULL REQUESTS</Text>
        {d.prs === undefined ? (
          <Text dimColor>gh not available here.</Text>
        ) : d.prs.length === 0 ? (
          <Text dimColor>No open PRs.</Text>
        ) : (
          d.prs.map(pr => (
            <Text key={`pr${pr.number}`} wrap="truncate-end">
              <Text color={pr.isDraft ? OFF : GREEN}>#{pr.number} </Text>
              <Text>{pr.title}</Text>
              <Text dimColor> {pr.headRefName}</Text>
            </Text>
          ))
        )}
        <Text> </Text>
        <Text color={CYAN} weight="bold">CONTAINERS</Text>
        {d.containers === undefined ? (
          <Text dimColor>{d.dockerNote}</Text>
        ) : d.containers.length === 0 ? (
          <Text dimColor>No containers.</Text>
        ) : (
          d.containers.map(c => (
            <Box key={`dk${c.name}`} flexDirection="row" justifyContent="space-between">
              <Text wrap="truncate-end">
                <Text color={c.state === 'running' ? GREEN : c.state === 'exited' ? HOT : '#fffb96'}>● </Text>
                <Text>{c.name}</Text>
                <Text dimColor> {c.image}</Text>
              </Text>
              <Text dimColor>{c.status}</Text>
            </Box>
          ))
        )}
      </Box>
    )
  })
}
