import test from 'node:test';
import assert from 'node:assert/strict';
import { menuPosition } from '../src/layout';

test('menu follows the button rather than the error container', () => {
  assert.deepEqual(menuPosition({ left: 30, top: 140, bottom: 178 }, 340, 280, { width: 1024, height: 768 }), { left: 30, top: 184, maxHeight: 572 });
});
test('menu opens above a button near the viewport bottom', () => {
  const position = menuPosition({ left: 30, top: 510, bottom: 548 }, 340, 300, { width: 1024, height: 600 });
  assert.equal(position.top, 204);
  assert.equal(position.maxHeight, 492);
});
test('narrow viewport and tall menus keep the panel inside the viewport', () => {
  const viewport = { width: 320, height: 480 };
  const position = menuPosition({ left: 290, top: 70, bottom: 110 }, 296, 900, viewport);
  assert.equal(position.left, 12);
  assert.equal(position.top, 116);
  assert.equal(position.maxHeight, 352);
  assert.ok(position.top + position.maxHeight <= viewport.height - 12);
});
test('constrained menu height does not shift it away from a middle button', () => {
  const position = menuPosition({ left: 30, top: 350, bottom: 388 }, 340, 600, { width: 900, height: 720 });
  assert.equal(position.top, 394);
  assert.equal(position.maxHeight, 314);
});
