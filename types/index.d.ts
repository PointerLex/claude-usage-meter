export type Tokens = { in: number; out: number }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Ctx = { percent?: number; tokens?: number; window: number }
export type GraphLine = { graph: string; hash: string; refs: string; subject: string }
export type Pr = { number: number; title: string; headRefName: string; isDraft: boolean }
export type Container = { name: string; image: string; state: string; status: string }
export type Dev = {
  branch?: string
  ahead: number
  behind: number
  changes: number
  graph: GraphLine[]
  prs?: Pr[]
  containers?: Container[]
  dockerNote?: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      limits: Limit[]
      tokens: Tokens
      ctx: Ctx
      ctxHist: number[]
      turnHist: number[]
      dev: Dev
    }
  }
}
