# 출처와 자산 안내

[README로 돌아가기](../README.md)

기존 출처 조사일은 2026-10-27이며, 2026-10-28에 현재 소스와 공개 참고 문헌의 표시를 다시 확인해 정리했습니다. 작성 이력과 참고 문헌, 원출처가 확인되지 않은 항목을 구분합니다.

## 기본 운지표

[dist/music.js](../dist/music.js)의 `familiar`에는 기본 운지 53개, `familiarFingers`에는 A·Dsus4·Dsus2·Gsus4의 손가락 번호 제안 4개가 있습니다. 프렛 배열은 6번 줄부터 1번 줄 순서이며, `-1`은 뮤트, `0`은 개방현입니다.

운지는 구성음과 프렛 조건으로 계산합니다. 기본 운지표는 일치하는 계산 결과의 추천 순위를 높이는 데 쓰이고, 손가락 번호 제안은 해당 운지에 적용됩니다.

| 항목 | 프로젝트에 추가된 경위 | Git 이력 |
| --- | --- | --- |
| 최초 기본 운지 18개 | 2026-10-26 최초 구현 중 Codex가 숫자 배열로 추가 | [최초 구현](https://github.com/0younge/Chordot/commit/7ebf45b413ff7fc8ef44303e460c2b4b5adc697a) |
| 추가 기본 운지 35개 | 같은 날 음악 기능 검토 중 Codex가 배열을 추가해 53개로 확장 | [음악 기능 보완](https://github.com/0younge/Chordot/commit/f52d4150e18a4ea75ab54e47d421bb0022a86575) |
| 손가락 번호 제안 4개 | 같은 검토 중 코드 전환의 손가락 이동을 고려해 추가 | [음악 기능 보완](https://github.com/0younge/Chordot/commit/f52d4150e18a4ea75ab54e47d421bb0022a86575) |

기존 조사에서 외부 운지 데이터 파일을 내려받거나 특정 사이트의 표를 가져온 기록은 발견하지 못했습니다. 다만 **각 배열의 원교재·사이트를 명시한 기록도 없어 개별 원출처는 확인되지 않았습니다.** 프로젝트에 추가된 이력만으로 독립 창작이나 권리 관계를 확정하지 않습니다.

2026-10-27 조사에서는 53개 운지의 구성음·필수음·슬래시 베이스와 손가락 번호 제안 4개의 일치를 확인했습니다. 이는 음악적 일치 검사이며, 출처 증명이나 실제 연주 편의성 검증은 아닙니다.

## 음악 이론 참고 문헌

아래는 코드 구성음과 기호를 확인할 때 참고한 자료입니다. 기본 운지 53개의 프렛 배열 원출처로 확인된 자료는 아닙니다. 현재 배포 파일에서 이 문헌의 원문·악보·표 이미지 복제는 발견하지 못했습니다.

| 자료 | 참고 범위 | 원자료의 이용 조건·확인 상태 |
| --- | --- | --- |
| [Ninth Chords Jazz Symbols](https://www.teoria.com/en/reference/j-k/jazzsymbols-9.php) — José Rodríguez Alvira, teoria | 9·maj9·add9 등 표기와 구성음 | 원문에 [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) 표시 |
| [Chord Labels](https://musictheory.pugetsound.edu/mt21c/ChordLabels.html) — Robert Hutchinson, *Music Theory for the 21st-Century Classroom* | 장7화음과 삼각형 기호 등 코드 표기 | [책의 저작권 안내](https://musictheory.pugetsound.edu/mt21c/frontmatter-3.html)에 GNU FDL 1.2 이상 표시. 해당 절은 Sher Music의 *The New Real Book, Vol. 1*을 바탕으로 했다고 명시 |
| [iiVItheory.pdf](https://music.arts.uci.edu/dobrian/f14/music16D/iiVItheory.pdf) — UC Irvine 강의 사이트 게시 자료 | 삼각형 기호와 장7화음 관계를 검색한 발췌 참고. 당시 기록만으로 PDF 본문 전체 열람 성공은 확인되지 않음 | 문서 제목은 `MarkLevineJazzTheoryBook`. PDF의 재사용 라이선스는 확인되지 않음 |

참고 문헌의 이용 조건은 각 원자료에 적용됩니다. 이 목록은 프로젝트 전체에 배포 라이선스를 지정하지 않으며, 원자료의 이미지·예제까지 재사용 허락을 확인했다는 뜻도 아닙니다.

## 구현과 자산

| 항목 | 구현·제작 방식 | 관련 파일 |
| --- | --- | --- |
| 운지표 | 계산한 줄·프렛·손가락 정보를 SVG의 선·원·글자로 표시. 외부 운지 이미지 파일은 포함하지 않음 | [dist/app.js](../dist/app.js)의 `diagram` |
| 재생음 | Web Audio API로 주파수와 배음을 합성. 외부 녹음·샘플·사운드폰트 파일은 포함하지 않음 | [dist/audio.js](../dist/audio.js) |
| 글꼴 | 기기의 시스템 글꼴 사용. 폰트 파일·외부 웹폰트 요청 없음 | [dist/style.css](../dist/style.css) |
| 실행·검증 코드 | 앱의 실행 파일은 프로젝트 내부 모듈 사용. 검증 코드는 Node.js 내장 모듈과 프로젝트 파일 사용 | [dist/index.html](../dist/index.html), [tests/](../tests/), [scripts/update-sw.js](../scripts/update-sw.js) |
| 헤더 로고 | 사용자가 선택한 C와 점 시안을 Codex 내장 이미지 생성 도구로 제작·정리한 PNG | [dist/chordot-logo.png](../dist/chordot-logo.png) |
| 앱 아이콘 | 같은 시안을 바탕으로 불투명 앰버 배경에 크림색 C와 점을 배치한 PNG | [dist/chordot-icon.png](../dist/chordot-icon.png) |

로고와 아이콘은 2026-10-27에 적용했습니다. 외부 로고 파일을 가져오지 않았으며, 생성된 글자 모양은 PNG에 포함돼 별도 폰트 파일을 배포하지 않습니다.

개별 운지의 원출처가 확인되거나 외부 데이터·음원·글꼴·이미지를 추가하면 원본 링크, 저작자, 이용 조건과 변경 여부를 이 문서에 보완합니다.
