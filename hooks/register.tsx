import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, Register } from 'claude-code'

import type { Card, Note } from '../types'
import { buildPrompt, parseReply } from './note'

const card = atom({ plugin: 'you-should-know-ko', key: 'card' } as const, null)

// 한 턴 안에서 6번째 step마다 판단함. 판단 1번이 메인 대화 전체를 다시 읽어 비용이 큼.
const EVERY = 6
const CARD_PROMPTS = 2
const SEEN_KEPT = 30
const MAX_SKIP = 16
const COST_COMMAND = 'ysk-cost'

type Spent = {
  checks: number
  notes: number
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

const NOTHING_SPENT: Spent = { checks: 0, notes: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 }

async function stored<T>($: EngineInterface, key: string, fallback: T): Promise<T> {
  const value = await $.store.get(key)

  return value === undefined ? fallback : (value as T)
}

async function spend($: EngineInterface, usage: ModelUsage, noted: boolean): Promise<void> {
  const spent = await stored($, 'spent', NOTHING_SPENT)
  await $.store.set('spent', {
    checks: spent.checks + 1,
    notes: spent.notes + (noted ? 1 : 0),
    input: spent.input + usage.input_tokens,
    cacheRead: spent.cacheRead + usage.cache_read_input_tokens,
    cacheWrite: spent.cacheWrite + usage.cache_creation_input_tokens,
    output: spent.output + usage.output_tokens,
  })
}

// 연달아 무시하면 판단을 건너뛰는 횟수를 1, 2, 4, ... 16까지 늘림.
function skipAfter(ignoredInARow: number): number {
  return ignoredInARow <= 2 ? 0 : Math.min(MAX_SKIP, 2 ** (ignoredInARow - 3))
}

async function closeCard($: EngineInterface, how: 'read' | 'dismissed' | 'ignored'): Promise<void> {
  await update($, card, () => null)
  if (how === 'ignored') {
    const ignored = (await stored($, 'ignoredInARow', 0)) + 1
    await $.store.set('ignoredInARow', ignored)
    await $.store.set('skip', skipAfter(ignored))
    return
  }
  await $.store.set('ignoredInARow', 0)
  await $.store.set('skip', how === 'dismissed' ? 1 : 0)
}

async function askInMain($: EngineInterface, shown: Note): Promise<void> {
  const question = `[${shown.kind}] ${shown.title}\n${shown.body}\n\n이 알림을 더 설명해줘.`
  const box = await $.prompt.read()
  await $.prompt.fill(box.text === ''
    ? { text: question, mode: 'replace' }
    : { text: `\n\n${question}`, mode: 'append' })
  await closeCard($, 'read')
}

function tokens(count: number): string {
  return count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : `${Math.round(count / 1000)}K`
}

// 모듈을 다시 읽으면 처음 값으로 돌아감. 판단은 한 번에 하나만 돌림.
let checking = false
let humanTurn = false

async function check($: EngineInterface): Promise<void> {
  if (checking || (await read($, card)) !== null) {
    return
  }
  const skip = await stored($, 'skip', 0)
  if (skip > 0) {
    await $.store.set('skip', skip - 1)
    return
  }
  if ((await $.session.surfaces()).length === 0) {
    return
  }
  checking = true
  try {
    const seen = await stored<string[]>($, 'seen', [])
    const reply = await $.model.fork({ prompt: buildPrompt(seen) })
    const note = reply.isAnswered ? parseReply(reply.text) : null
    if ('usage' in reply) {
      await spend($, reply.usage, note !== null)
    }
    if (note === null) {
      return
    }
    await $.store.set('seen', [...seen, note.line].slice(-SEEN_KEPT))
    const shown: Card = { ...note, promptsLeft: CARD_PROMPTS }
    await update($, card, () => shown)
  } finally {
    checking = false
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COST_COMMAND,
      description: '한국어 알림(you-should-know-ko)이 쓴 판단 횟수와 토큰을 보여줌',
    })

    return next(e)
  })

  on('command.run', { command: COST_COMMAND }, async $ => {
    const spent = await stored($, 'spent', NOTHING_SPENT)
    // Opus 5.5 단가(입력 4, 캐시 쓰기 5, 캐시 읽기 0.2, 출력 20 달러/백만 토큰)로 어림함.
    const usd = (spent.input * 4 + spent.cacheWrite * 5 + spent.cacheRead * 0.2 + spent.output * 20) / 1_000_000
    const text = [
      `판단 ${spent.checks}회, 알림 ${spent.notes}회.`,
      `토큰: 캐시 읽기 ${tokens(spent.cacheRead)}, 캐시 쓰기 ${tokens(spent.cacheWrite)}, 그 밖의 입력 ${tokens(spent.input)}, 출력 ${tokens(spent.output)}.`,
      `Opus 5.5 단가로 어림하면 약 $${usd.toFixed(2)}임.`,
    ].join('\n')

    return { text }
  })

  on('prompt.submit', async ($, e, next) => {
    humanTurn = e.origin.kind === 'composer' || e.origin.kind === 'bridge'
    const shown = humanTurn ? await read($, card) : null
    if (shown !== null) {
      if (shown.promptsLeft <= 1) {
        await closeCard($, 'ignored')
      } else {
        await update($, card, current => (current === null ? null : { ...current, promptsLeft: current.promptsLeft - 1 }))
      }
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    if (humanTurn && e.agentId === undefined && e.index > 0 && e.index % EVERY === 0) {
      void check($)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.view.agentId !== undefined) {
      return next(e)
    }
    const shown = await read($, card)
    if (shown === null) {
      return next(e)
    }
    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" borderStyle="round" paddingX={1}>
        <Text bold>
          {shown.kind}: {shown.title}
        </Text>
        <Text>{shown.body}</Text>
        <Box marginTop={1}>
          <Box marginRight={2}>
            <Button key="read" plain hotkey="1" label="알겠음" onPress={() => closeCard($, 'read')} />
          </Box>
          <Box marginRight={2}>
            <Button key="ask" plain hotkey="2" label="메인 대화에서 묻기" onPress={() => askInMain($, shown)} />
          </Box>
          <Button key="dismiss" plain hotkey="0" label="닫기" onPress={() => closeCard($, 'dismissed')} />
        </Box>
      </Box>
    )
  })
}
