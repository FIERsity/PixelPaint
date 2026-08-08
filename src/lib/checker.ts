// 与实际显示像素对齐的透明背景棋盘格样式。
// 一组棋盘格由两个 checker cell 组成，因此 background-size 是 cell 的两倍。
export function checkerStyle(cell: number): {
  backgroundSize: string;
  backgroundPosition: string;
} {
  const size = Math.max(0.1, cell);
  return {
    backgroundSize: `${size * 2}px ${size * 2}px`,
    backgroundPosition: `0 0, 0 ${size}px, ${size}px -${size}px, -${size}px 0`,
  };
}
