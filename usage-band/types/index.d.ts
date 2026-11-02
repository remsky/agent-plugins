declare module 'claude-code' {
  interface PluginState {
    'usage-band': { lastRequestAt: number | null; baseline: number | null; rebuilt: boolean }
  }
}
