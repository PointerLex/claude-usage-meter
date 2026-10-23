import { expect, test } from 'claude-code/testing'
import { b64, cells, columnChart, effortStyle, elapsed, hint, modelColor, k, lerp, parseDocker, parseGraph, parseStatus, until } from './register'

test('gradient ends, token units and reset countdown', () => {
  expect(lerp('#00f0ff', '#ff00e6', 0, 12)).toBe('#00f0ff')
  expect(lerp('#00f0ff', '#ff00e6', 11, 12)).toBe('#ff00e6')
  expect([k(678), k(12345), k(2_500_000)]).toEqual(['678', '12.3k', '2.50M'])
  const now = Date.parse('2026-10-22T12:00:00Z')
  expect(until('2026-10-22T13:30:00Z', now)).toBe('1h30m')
  expect(until('2026-10-25T16:00:00Z', now)).toBe('3d4h')
})

test('cells light the right share of the bar', () => {
  const c = cells(50, 8)
  expect(c.filter(x => x.ch === '█').length).toBe(4)
  expect(c[0]?.color).toBe('#00f0ff')
  expect(cells(150, 4).every(x => x.ch === '█')).toBe(true)
})

test('base64 and the column chart', () => {
  expect(b64(Uint8Array.of(1, 2, 3, 4))).toBe('AQIDBA==')
  // one full column, 1x1: a full block, cyan, on black
  expect(columnChart([5], 1, 1)).toBe(b64(new Uint8Array(Uint32Array.of(0x2588, 0x00f0ff, 0).buffer)))
  // empty history slots on the left are spaces
  expect(columnChart([5], 2, 1)).toBe(b64(new Uint8Array(Uint32Array.of(0x20, 0x00f0ff, 0, 0x2588, 0x00f0ff, 0).buffer)))
})

test('git status, graph and docker parsing', () => {
  expect(parseStatus('# branch.oid abc\n# branch.head main\n# branch.ab +2 -1\n1 .M N... x\n? new.txt\n')).toEqual({
    branch: 'main',
    ahead: 2,
    behind: 1,
    changes: 2,
  })
  const g = parseGraph('* \x1fabc123\x1f (HEAD -> main)\x1ffix bar\n|\\n')
  expect(g[0]).toEqual({ graph: '* ', hash: 'abc123', refs: '(HEAD -> main)', subject: 'fix bar' })
  expect(g[1]?.hash).toBe('')
  expect(parseDocker('{"Names":"db","Image":"postgres","State":"running","Status":"Up 2h"}\n')).toEqual([
    { name: 'db', image: 'postgres', state: 'running', status: 'Up 2h' },
  ])
})

test('subagent tool hint and elapsed time', () => {
  expect(hint('Bash', { command: 'npm test\nmore' })).toBe('Bash: npm test')
  expect(hint('Read', { file_path: 'a.ts' })).toBe('Read: a.ts')
  expect(hint('TodoWrite', {})).toBe('TodoWrite')
  expect([elapsed(5_000), elapsed(125_000)]).toEqual(['5s', '2m05s'])
})

test('effort and model styles', () => {
  expect(effortStyle('ab', 'low').map(c => c.color)).toEqual(['#5c5c7a', '#5c5c7a'])
  expect(effortStyle('abc', 'xhigh').map(c => c.color)).toEqual(['#00f0ff', lerp('#00f0ff', '#ff00e6', 1, 3), '#ff00e6'])
  // ticks 22-23: glint well off the text, so plain rainbow; it flows one letter per tick
  const at = (t: number) => effortStyle('abcdefg', 'max', t).map(c => c.color)
  expect(new Set(at(22)).size).toBe(7)
  expect(at(23).slice(0, 6)).toEqual(at(22).slice(1))
  // tick 2: glint on the third letter, its neighbours tinted
  expect(at(2).slice(1, 4)).toEqual(['#ffd6f5', '#ffffff', '#ffd6f5'])
  expect([modelColor('claude-opus-5-5'), modelColor('haiku'), modelColor(undefined)]).toEqual(['#ff00e6', '#05ffa1', '#fffb96'])
})
