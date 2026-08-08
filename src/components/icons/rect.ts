import type { PxlKitData } from '../../lib/pixelTypes';

// 矩形（边框）— PixelPaint 自绘
export const Rect: PxlKitData = {
  name: 'rect',
  size: 16,
  category: 'tool',
  grid: [
    '................',
    '..GGGGGGGGGGGG..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..G..........G..',
    '..GGGGGGGGGGGG..',
    '................',
    '................',
  ],
  palette: { G: '#3b82f6' },
  tags: ['rect', 'square', 'shape'],
};
