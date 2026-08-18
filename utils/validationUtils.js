export const isValidThaiPhone = (value, { required = false } = {}) => {
  const phone = String(value ?? "").trim();
  if (!phone) return !required;
  return /^0\d+$/.test(phone);
};

export const genderFromTitle = (value) => {
  const title = String(value ?? "").trim();
  if (title === "นาย") return "ชาย";
  if (title === "นาง" || title === "นางสาว") return "หญิง";
  return null;
};
