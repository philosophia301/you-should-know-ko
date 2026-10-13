export type NoteKind = '주의' | '알아둘 것'

export type Note = {
  kind: NoteKind
  line: string
  title: string
  body: string
}

// promptsLeft: 사람이 이 카드를 보고도 프롬프트를 몇 번 더 보내면 무시한 것으로 볼지.
export type Card = Note & { promptsLeft: number }

declare module 'claude-code' {
  interface PluginState {
    'you-should-know-ko': { card: Card | null }
  }
}
