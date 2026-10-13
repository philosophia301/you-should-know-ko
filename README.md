# you-should-know-ko

Claude Code 메인 대화를 지켜보다가 사용자가 놓치기 쉬운 것을 한국어 카드로 알려주는 plugin임. 내장 `you-should-know` 알림의 한국어판임.

- 사람이 시작한 턴에서 6번째 step마다 대화를 fork해서 알릴 것이 있는지 판단함.
- 알릴 것이 있으면 프롬프트 위에 `주의` 또는 `알아둘 것` 카드를 띄움.
- 카드 버튼: `1` 알겠음, `2` 메인 대화에서 묻기, `0` 닫기. 카드를 두고 프롬프트를 두 번 보내면 무시한 것으로 보고 닫으며, 연달아 무시하면 판단 간격을 늘림.

## 설치

터미널의 Claude Code 프롬프트에서 실행함.

```
/plugin install you-should-know-ko --marketplace philosophia301/you-should-know-ko
```

marketplace 추가를 물으면 `y`, scope는 user를 고름. 셸에서는 아래로 같은 설치를 함.

```
claude plugin install you-should-know-ko --marketplace philosophia301/you-should-know-ko
```

## 내장 알림 끄기

내장 영어판과 같이 켜 두면 카드가 두 개 뜸. `~/.claude/settings.json`에 아래를 넣음.

```json
{
  "enabledPlugins": {
    "cc-plugin-you-should-know@builtin": false
  }
}
```

## 비용

판단 1번이 메인 대화 전체를 다시 읽으므로 토큰을 씀. `/ysk-cost`로 누적 판단 횟수, 알림 횟수, 토큰을 볼 수 있음. 금액은 Opus 5.5 단가로 어림한 값이라 다른 모델을 쓰면 맞지 않음.

## 요구 사항

Claude Code 2.1.296에서 검증함. plugin hooks API를 쓰므로 이보다 오래된 버전에서는 로드되지 않을 수 있음.

## 개발

```
claude plugin validate .
claude plugin test .
```
