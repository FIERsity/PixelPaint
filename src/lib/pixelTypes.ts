// PixelPaint · 本地像素图标数据格式
// 灵感来自 Pxlkit 的 PxlKitData 结构（https://pxlkit.xyz）
// 许可：Pxlkit Assets License（免费使用 + 署名），详见项目 README。

export interface PxlKitData {
  name: string;
  size: number; // 网格边长（像素）
  category?: string;
  grid: string[]; // size 行，每行 size 个字符；'.' 或 ' ' = 透明
  palette: Record<string, string>; // 字符 -> hex 颜色
  tags?: string[];
  author?: string;
}
