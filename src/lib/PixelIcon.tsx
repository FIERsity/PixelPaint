import type { PxlKitData } from "./pixelTypes";

interface PixelIconProps {
  data: PxlKitData;
  size?: number;
  className?: string;
}

// 把 PxlKitData 网格渲染成像素风 SVG（每个非透明字符 = 一个方块）
export default function PixelIcon({ data, size = 20, className }: PixelIconProps) {
  const n = data.size || 16;
  const rects: React.ReactNode[] = [];
  data.grid.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === "." || ch === " " || ch === "\r") continue;
      const color = data.palette[ch];
      if (!color) continue;
      rects.push(
        <rect key={`${y}-${x}`} x={x} y={y} width={1} height={1} fill={color} />,
      );
    }
  });
  return (
    <svg
      viewBox={`0 0 ${n} ${n}`}
      width={size}
      height={size}
      className={className}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {rects}
    </svg>
  );
}
