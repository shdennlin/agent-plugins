export type CutInputKey = 'hasText'

declare module 'claude-code' {
  interface PluginState {
    'cut-input': { hasText: boolean }
  }
}
