/**
 * ใช้ทำ receive_code เช่น 20260614
 */
export const formatReceiveCodeDate = (date = new Date()) => {
  const dateValue = date instanceof Date ? date : new Date(date);

  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");

  return `${year}${month}${day}`;
};

/**
 * ใช้ pad running เช่น 1 => 000001
 */
export const padRunningNumber = (value, length = 6) => {
  return String(value).padStart(length, "0");
};

