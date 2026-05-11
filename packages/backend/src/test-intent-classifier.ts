/**
 * Smoke test for Intent Classifier v1 Rules layer.
 * Run: npx tsx src/test-intent-classifier.ts
 */

import { classify } from './intent-classifier.js';

const cases: Array<[string, string, string]> = [
  ['明天下午3点提醒我打电话给张三', 'operations', 'life'],
  ['每天晚上10点提醒我吃药', 'operations', 'life'],
  ['监控茅台股价跌到1500提醒我', 'operations', 'finance'],
  ['每周定期提醒我联系父母', 'operations', 'social'],
  ['做一个用户登录功能', 'pipeline', 'engineering'],
  ['实现新的支付接口', 'pipeline', 'engineering'],
  ['解释一下康德的定言命令', 'direct', 'unknown'],
  ['帮我写一段代码', 'direct', 'unknown'],
  ['今天天气怎么样', 'direct', 'unknown'],
];

async function main() {
  let passed = 0;
  for (const [text, expectDepth, expectDomain] of cases) {
    const r = await classify(text);
    const ok = r.execution_depth === expectDepth && r.domain === expectDomain;
    console.log(`${ok ? '✅' : '❌'} [${r.execution_depth}/${r.domain} conf=${r.confidence.toFixed(2)} method=${r.method}]  ${text}`);
    if (!ok) console.log(`   expected: ${expectDepth}/${expectDomain}`);
    if (ok) passed++;
  }
  console.log(`\nIntent Classifier v1: ${passed}/${cases.length} passed`);
  if (passed < cases.length) process.exit(1);
}

main();
