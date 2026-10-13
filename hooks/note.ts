import type { Note } from '../types'

const LINE_MAX = 80
const TITLE_MAX = 60
const BODY_MAX = 600

export function buildPrompt(seen: readonly string[]): string {
  const already = seen.length > 0 ? seen.map(line => `- ${line}`).join('\n') : '(없음)'

  return [
    '<알림 판단 요청>',
    '이 메시지는 사용자가 보낸 것이 아님. 이 세션 옆에서 사용자를 돕는 관찰자로서 판단함.',
    '지금까지의 작업에서 사용자가 꼭 알아야 하는데 놓치고 있을 가능성이 큰 것이 하나 있는지 봄.',
    '대상: 사용자에게 말하지 않고 내린 결정, 되돌리기 어려운 부작용, 확인하지 않았는데 끝난 것처럼 보이는 일, 오해하기 쉬운 결과, 다음 행동에 영향을 주는 동작 원리.',
    '기준을 높게 잡음. 사용자가 이미 아는 것, 사소한 것, 방금 답에서 설명한 것은 알리지 않음. 대부분은 알릴 것이 없는 게 맞음.',
    '',
    '이미 알린 것:',
    already,
    '',
    '도구를 쓰지 말고 길게 생각하지 말고 바로 답함. 답은 JSON 한 줄만 씀.',
    '알릴 것이 없으면: {"알림": false}',
    '알릴 것이 있으면: {"알림": true, "종류": "주의" 또는 "알아둘 것", "한줄": "40자 이내 요약", "제목": "핵심을 담은 짧은 제목", "설명": "쉬운 한국어 음슴체, 300자 이내, 처음 나오는 용어는 풀어서"}',
    '"주의"는 이 세션의 작업과 결정에 관한 것이고 "알아둘 것"은 개념이나 동작 원리에 관한 것임.',
    '</알림 판단 요청>',
  ].join('\n')
}

// 모델이 코드 블록이나 앞뒤 문장을 붙여도 첫 `{`부터 마지막 `}`까지를 JSON으로 읽음.
export function parseReply(text: string): Note | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return null
  }
  let value: unknown
  try {
    value = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const reply = value as Record<string, unknown>
  if (reply['알림'] !== true) {
    return null
  }
  const line = field(reply['한줄'], LINE_MAX)
  const title = field(reply['제목'], TITLE_MAX)
  const body = field(reply['설명'], BODY_MAX)
  if (line === '' || title === '' || body === '') {
    return null
  }

  return { kind: reply['종류'] === '주의' ? '주의' : '알아둘 것', line, title, body }
}

function field(value: unknown, max: number): string {
  if (typeof value !== 'string') {
    return ''
  }
  const text = value.trim()

  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
