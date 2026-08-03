const YN_VALUES = new Set(["Y", "N"]);

export const cleanYN = (value) => {
  const cleanValue = String(value ?? "").trim().toUpperCase();
  return YN_VALUES.has(cleanValue) ? cleanValue : null;
};

export const getPagination = (pageValue, limitValue) => {
  const page = Math.max(Number.parseInt(pageValue, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(limitValue, 10) || 20, 1), 100);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};
