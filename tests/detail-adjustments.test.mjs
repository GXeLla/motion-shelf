import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDetailDraft, setDetailValue, renderDetailAdjustments } from '../scripts/detail-adjustments.js';
import { buildWholeAnimation, buildParentClass } from '../scripts/animation-code.js';
const source = readFileSync(new URL('../animations/3d-image-turn-reveal.css', import.meta.url), 'utf8');
const original = JSON.parse(source.slice(source.indexOf('{', source.indexOf('@motion-shelf')), source.indexOf('*/', source.indexOf('@motion-shelf'))).trim());

test('detail changes affect copied motion, parent and authoritative timing without editing the source', () => {
  const before = JSON.stringify(original);
  const draft = createDetailDraft(original);
  assert(setDetailValue(draft, 'target', '--ms-rotation-y', '24deg'));
  assert(setDetailValue(draft, 'parent', '--ms-perspective', '850px'));
  assert(setDetailValue(draft, 'timing', 'duration', '750ms'));
  assert(setDetailValue(draft, 'timing', 'delay', '-0.2s'));
  assert(setDetailValue(draft, 'timing', 'easing', 'linear'));
  assert(setDetailValue(draft, 'timing', 'iterationCount', '3'));
  const code = buildWholeAnimation(draft);
  assert.match(code, /--ms-rotation-y: 24deg/);
  assert.match(buildParentClass(draft), /--ms-perspective: 850px/);
  assert.match(code, /animation-duration:.*750ms/);
  assert.match(code, /animation-delay:.*-0.2s/);
  assert.match(code, /animation-timing-function:.*linear/);
  assert.match(code, /animation-iteration-count: 3/);
  assert.equal(JSON.stringify(original), before);
  assert.deepEqual(createDetailDraft(original), original);
});

test('invalid intermediate inputs keep the last valid draft and custom curves reach copy', () => {
  const draft = createDetailDraft(original);
  const before = JSON.stringify(draft);
  for (const [scope,name,value] of [['timing','duration','0s'], ['timing','delay','-'], ['timing','iterationCount','abc'], ['timing','cubicBezier','2,0,0,1'], ['target','--ms-rotation-y','20deg; opacity: 0']]) {
    assert.equal(setDetailValue(draft,scope,name,value),false);
    assert.equal(JSON.stringify(draft),before);
  }
  assert(setDetailValue(draft,'timing','cubicBezier','0.2, 0.4, 0.6, 1'));
  assert.match(buildWholeAnimation(draft), /cubic-bezier\(0.2, 0.4, 0.6, 1\)/);
});

test('timing appears once and adjustments start collapsed, including records without custom variables', () => {
  const markup = renderDetailAdjustments(original);
  assert.doesNotMatch(markup,/data-adjust-name="--ms-(duration|delay|ease)"/);
  assert.match(markup,/<details class="detail-adjustments">/);
  assert.match(renderDetailAdjustments({duration:2,css:'',parent:''}),/data-adjust-name="duration"/);
});
