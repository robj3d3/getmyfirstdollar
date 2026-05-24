import { parseYouTubeInput } from '../api/_lib/redirect-page.js';

const cases = [
  ['https://youtu.be/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://youtu.be/dQw4w9WgXcQ?t=42', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://youtube.com/watch?v=dQw4w9WgXcQ&feature=share', 'dQw4w9WgXcQ'],
  ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/shorts/abcDEF12345', 'abcDEF12345'],
  ['https://www.youtube.com/shorts/abcDEF12345?si=xyz', 'abcDEF12345'],
  ['https://www.youtube.com/live/ZyhrYis509A', 'ZyhrYis509A'],
  ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ['   dQw4w9WgXcQ   ', 'dQw4w9WgXcQ'],
  ['https://www.youtube.com/', null],
  ['https://www.youtube.com/watch', null],
  ['https://www.youtube.com/watch?v=tooShort', null],
  ['https://example.com/dQw4w9WgXcQ', null],
  ['not a url', null],
  ['', null],
  [null, null],
  [undefined, null],
];

let pass = 0;
let fail = 0;
for (const [input, expected] of cases) {
  const got = parseYouTubeInput(input);
  const ok = got === expected;
  if (ok) {
    pass++;
    console.log(`PASS  ${JSON.stringify(input)} -> ${JSON.stringify(got)}`);
  } else {
    fail++;
    console.log(`FAIL  ${JSON.stringify(input)} -> ${JSON.stringify(got)} (expected ${JSON.stringify(expected)})`);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
