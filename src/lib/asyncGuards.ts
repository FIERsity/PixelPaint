export interface ConversionResponseToken {
  id: number;
  generation: number;
}

export function isCurrentConversionResponse(
  response: ConversionResponseToken,
  currentId: number,
  currentGeneration: number,
  hasSource: boolean,
): boolean {
  return hasSource && response.id === currentId && response.generation === currentGeneration;
}

export function isCurrentAsyncRun(
  runId: number,
  currentRunId: number,
  mounted: boolean,
): boolean {
  return mounted && runId === currentRunId;
}
