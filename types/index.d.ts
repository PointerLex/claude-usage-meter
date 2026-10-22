export type Tokens = { in: number; out: number }
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { limits: Limit[]; tokens: Tokens }
  }
}
