export const SIZE_PRESET_VALUES = [16, 32, 64, 128, 256] as const;

export type SizePresetValue = (typeof SIZE_PRESET_VALUES)[number];
export type SizePreset = `${SizePresetValue}` | "custom";

export function matchSquareSizePreset(width: number, height: number): SizePreset {
  if (width !== height) return "custom";
  return SIZE_PRESET_VALUES.includes(width as SizePresetValue) ? String(width) as SizePreset : "custom";
}
