// Quick verification of the TTS markdown stripper. Run: pnpm --filter @claude-web/backend exec tsx src/test-strip-speech.ts
// Imports from the frontend hook (the function is pure, no React).
import { stripForSpeech } from "../../frontend/src/hooks/useVoice";

const cases: Array<[string, string]> = [
  ["**重点**完成", "重点完成"],
  ["这是 **粗体** 和 *斜体*", "这是 粗体 和 斜体"],
  ["# 标题一\n## 二级", "标题一 二级"],
  ["- 列表项一\n- 列表项二", "列表项一 列表项二"],
  ["1. 第一\n2. 第二", "第一 第二"],
  ["[Claude](https://claude.ai) 网页", "Claude 网页"],
  ["参考 ![logo](x.png) 这里", "参考 图：logo 这里"],
  ["内联 `code` 文本", "内联 code 文本"],
  ["代码块：```ts\nconst x = 1;\n```", "代码块： 代码块。"],
  ["~~删除~~ 项", "删除 项"],
  ["> 引用", "引用"],
  ["| 列1 | 列2 |\n| --- | --- |\n| a | b |", "列1，列2 a，b"],
  ["A_B_C 不变", "A_B_C 不变"],
  ["snake_case 变量", "snake_case 变量"],
  ["纯文本不变", "纯文本不变"],
  ["**完成了三件事：** 第一加缓存，第二修 bug。", "完成了三件事： 第一加缓存，第二修 bug。"],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = stripForSpeech(input);
  if (got === expected) {
    pass++;
    console.log(`  ✓ ${JSON.stringify(input).slice(0, 50)}`);
  } else {
    fail++;
    console.log(`  ✗ ${JSON.stringify(input).slice(0, 50)}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
