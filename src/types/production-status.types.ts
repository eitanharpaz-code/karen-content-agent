// Production status types for Sprint 7
export type ProductionStatusType =
  | "filmed"
  | "edited"
  | "cover_ready"
  | "copy_ready"
  | "uploaded";

export interface StatusUpdateRequest {
  statusType: ProductionStatusType;
  contentName: string; // Hebrew content name extracted from message
  rawMessage: string; // Original user message
}

export interface ProductionStatusMapping {
  statusType: ProductionStatusType;
  columnName: string; // Hebrew column name in משימות הפקה
  detectionPatterns: string[]; // Hebrew phrases to detect
}
