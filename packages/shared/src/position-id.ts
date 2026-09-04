import { createRequire } from "node:module";

interface PositionIdContract {
  MAX_POSITION_ID_LENGTH: number;
  POSITION_ID_PATTERN: RegExp;
  isPositionId(value: unknown): value is string;
}

const require = createRequire(import.meta.url);
const contract = require("../position-id.cjs") as PositionIdContract;

/** Exact mirror of the digital-employee organization identifier contract. */
export const MAX_POSITION_ID_LENGTH = contract.MAX_POSITION_ID_LENGTH;
export const POSITION_ID_PATTERN = contract.POSITION_ID_PATTERN;
export const isPositionId = contract.isPositionId;
