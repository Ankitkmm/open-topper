export type ProgressItemType = "pyq" | "relevant_question" | "topper_copy";

export function makeProgressItemId(type: ProgressItemType, id: string) {
  return `${type}:${id}`;
}

export function progressItemCandidates(type: ProgressItemType, id: string) {
  return [makeProgressItemId(type, id), id];
}
