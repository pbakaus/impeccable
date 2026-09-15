import { expect, test } from 'bun:test';
import { comparisonSize, hoverPan } from './viewport';

test('portrait regions fit the available height without distorting the reference', () => {
  const size = comparisonSize(768, 922, 210, 248, 'fit');
  expect(size.height).toBe(248);
  expect(size.width).toBeCloseTo(206.577, 2);
  expect(size.width / size.height).toBeCloseTo(768 / 922);
});
test('zoom uses comp pixels, including tiny texture regions and thin controls', () => {
  expect(comparisonSize(154, 102, 210, 248, 4)).toEqual({scale:4,width:616,height:408});
  expect(comparisonSize(1440, 4, 210, 248, 1)).toEqual({scale:1,width:1440,height:4});
});

test('hover panning reaches both edges, synchronizes midpoint, and ignores fitted images', () => {
  expect(hoverPan(10,10,200,600)).toBe(0);
  expect(hoverPan(110,10,200,600)).toBeCloseTo(200);
  expect(hoverPan(210,10,200,600)).toBe(400);
  expect(hoverPan(-30,10,200,600)).toBe(0);
  expect(hoverPan(300,10,200,600)).toBe(400);
  expect(hoverPan(110,10,200,150)).toBe(0);
  expect(hoverPan(110,10,0,600)).toBe(0);
});
