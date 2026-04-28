// Verify parseConvoCommand handles the four voice commands + edge cases.
import { parseConvoCommand } from "../../frontend/src/hooks/useVoice";

const cases: Array<[string, { cmd: string | null; prefix: string }]> = [
  // submit
  ["你好世界 发送", { cmd: "submit", prefix: "你好世界" }],
  ["列出文件 提交", { cmd: "submit", prefix: "列出文件" }],
  ["fix the bug send", { cmd: "submit", prefix: "fix the bug" }],
  ["发送", { cmd: "submit", prefix: "" }],

  // pause
  ["暂停", { cmd: "pause", prefix: "" }],
  ["我先想一下 暂停", { cmd: "pause", prefix: "我先想一下" }],
  ["暂停录音", { cmd: "pause", prefix: "" }],

  // resume
  ["继续", { cmd: "resume", prefix: "" }],
  ["恢复", { cmd: "resume", prefix: "" }],
  ["继续录音", { cmd: "resume", prefix: "" }],

  // clear
  ["清除", { cmd: "clear", prefix: "" }],
  ["清空", { cmd: "clear", prefix: "" }],
  ["重来", { cmd: "clear", prefix: "" }],
  ["不对 重新说", { cmd: "clear", prefix: "不对" }],

  // no command
  ["这是一句普通的话", { cmd: null, prefix: "这是一句普通的话" }],
  ["列出当前目录", { cmd: null, prefix: "列出当前目录" }],

  // trailing punctuation
  ["你好。发送。", { cmd: "submit", prefix: "你好" }], // trailing punct stripped from prefix too
  ["发送！", { cmd: "submit", prefix: "" }],

  // command in middle should NOT match (only end)
  ["发送邮件给老板", { cmd: null, prefix: "发送邮件给老板" }],
  ["暂停一下，听我说", { cmd: null, prefix: "暂停一下，听我说" }],
];

let pass = 0, fail = 0;
for (const [input, expected] of cases) {
  const got = parseConvoCommand(input);
  if (got.cmd === expected.cmd && got.prefix === expected.prefix) {
    pass++;
    console.log(`  ✓ ${JSON.stringify(input)} → ${expected.cmd ?? "null"} | ${JSON.stringify(expected.prefix)}`);
  } else {
    fail++;
    console.log(`  ✗ ${JSON.stringify(input)}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      got:      ${JSON.stringify(got)}`);
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
