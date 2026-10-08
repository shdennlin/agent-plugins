export type PeekTag = number

declare module 'claude-code' {
  interface PluginState {
    'image-peek': { tags: PeekTag[]; selected: PeekTag | null }
  }
}
