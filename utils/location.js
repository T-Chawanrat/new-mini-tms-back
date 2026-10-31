import { toNumberOrNull } from "./input.js";

// Callers choose how to handle invalid values; missing values remain null.
export const parseCoordinate = (value, min, max, invalidValue = null) => {
  if (value === undefined || value === null || value === "") return null;
  const number = toNumberOrNull(value);
  return number !== null && number >= min && number <= max ? number : invalidValue;
};

export const parseLocation = ({ latitude, longitude, accuracy, maxAccuracy = Infinity, invalidValue = null }) => ({
  latitude: parseCoordinate(latitude, -90, 90, invalidValue),
  longitude: parseCoordinate(longitude, -180, 180, invalidValue),
  accuracy: parseCoordinate(accuracy, 0, maxAccuracy, invalidValue),
});

export const parseOptionalLocation = (values) => {
  const location = parseLocation({ ...values, invalidValue: false });
  if (Object.values(location).includes(false)) return false;
  if (Object.values(location).every((value) => value === null)) return null;
  return Object.values(location).every((value) => value !== null) ? location : false;
};
