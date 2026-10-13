import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderElement } from 'claude-code'

import { buildPrompt, parseReply } from '../hooks/note'

const PLUGIN = 'you-should-know-ko'
const NOTE = '{"알림": true, "종류": "주의", "한줄": "떠 있는 창은 재시작해야 새 값을 읽음", "제목": "재시작 전에는 옛 설정", "설명": "설정 파일만 바뀌었음."}'
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 19 },
  view: {},
}

// 엔진 아래에서 답하는 쪽을 테스트가 맡음: fork 응답, 화면 표면, 프롬프트와 step 결과.
function world(on: On, reply: string, forks: { count: number }): Map<string, unknown> {
  const store = new Map<string, unknown>()
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.delete', ($, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('model.fork', () => {
    forks.count += 1
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('prompt.submit', ($, e) => ({ text: e.text }))
  // 카드가 없을 때 엔진 대신 빈 band를 그림.
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return h(Box, {}) as RenderElement
  })
  on('turn.step', async function* ($, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: null, usage: null }
  })

  return store
}

async function step($: Engine, index: number, agentId?: string): Promise<void> {
  const stream = $.turn.step({ turnId: 't1', index, model: 'claude-opus-5-5', messageCount: 10, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // step 결과만 필요함
  }
}

// step 뒤 판단은 기다리지 않고 돌아가므로, 엔진 왕복을 여러 번 해서 끝나기를 기다림.
async function settle($: Engine): Promise<void> {
  for (let round = 0; round < 30; round += 1) {
    await $.command.run({ command: 'ysk-cost' } as never)
  }
}

describe('응답 해석', () => {
  test('알릴 것이 없다는 답은 카드를 만들지 않음', () => {
    expect(parseReply('{"알림": false}')).toBe(null)
  })

  test('코드 블록에 싸인 답도 읽고 종류를 지킴', () => {
    const note = parseReply('```json\n' + NOTE + '\n```')
    expect(note?.kind).toBe('주의')
    expect(note?.title).toBe('재시작 전에는 옛 설정')
  })

  test('필드가 빠지거나 JSON이 아니면 버림', () => {
    expect(parseReply('{"알림": true, "제목": "제목만"}')).toBe(null)
    expect(parseReply('알릴 것 없음')).toBe(null)
  })

  test('이미 알린 줄을 판단 지시에 넣음', () => {
    expect(buildPrompt(['앞서 알린 것'])).toContain('- 앞서 알린 것')
  })
})

describe('판단과 카드', () => {
  test('사람이 시작한 턴의 6번째 step에서만 fork하고 카드를 띄움', async ($, on) => {
    const forks = { count: 0 }
    const store = world(on, NOTE, forks)
    await $.prompt.submit({ text: '작업해줘', origin: { kind: 'composer' } } as never)
    await step($, 5)
    await settle($)
    expect(forks.count).toBe(0)
    await step($, 6)
    await settle($)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(forks.count).toBe(1)
    expect((await band.find({ text: /재시작 전에는 옛 설정/ }))?.text).toContain('주의')
    expect((await band.find({ key: 'ask' }))?.props['label']).toBe('메인 대화에서 묻기')
    expect((await $.command.run({ command: 'ysk-cost' } as never)).text).toContain('판단 1회, 알림 1회.')
  })

  test('subagent step과 자동으로 시작된 턴은 판단하지 않음', async ($, on) => {
    const forks = { count: 0 }
    const store = world(on, NOTE, forks)
    await $.prompt.submit({ text: '작업해줘', origin: { kind: 'composer' } } as never)
    await step($, 6, 'agent-1')
    await $.prompt.submit({ text: '알림', origin: { kind: 'task-notification' } } as never)
    await step($, 6)
    await settle($)
    expect(forks.count).toBe(0)
  })

  test('알겠음을 누르면 카드가 닫히고 다음 판단을 막지 않음', async ($, on) => {
    const forks = { count: 0 }
    const store = world(on, NOTE, forks)
    await $.prompt.submit({ text: '작업해줘', origin: { kind: 'composer' } } as never)
    await step($, 6)
    await settle($)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    await band.press({ key: 'read' })
    expect(await band.find({ key: 'read' })).toBe(undefined)
    expect(store.get('skip')).toBe(0)
  })

  test('카드를 두고 프롬프트를 두 번 보내면 무시로 보고 닫음', async ($, on) => {
    const forks = { count: 0 }
    const store = world(on, NOTE, forks)
    await $.prompt.submit({ text: '작업해줘', origin: { kind: 'composer' } } as never)
    await step($, 6)
    await settle($)
    await $.prompt.submit({ text: '다음', origin: { kind: 'composer' } } as never)
    await $.prompt.submit({ text: '또 다음', origin: { kind: 'composer' } } as never)
    const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND })
    expect(await band.find({ key: 'read' })).toBe(undefined)
    expect(store.get('ignoredInARow')).toBe(1)
  })
})
