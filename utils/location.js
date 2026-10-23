import { toNumberOrNull } from "./input.js";

// Callers choose how to handle invalid values; missing values remain null.
export const parseCoordinate = (value, min, max, invalidValue = null) => {
  if (value === undefined || value === null || value === "") return null;
  const number = toNumberOrNull(value);
  return number !== null && number >= min && number <= max ? number : invalidValue;
};
