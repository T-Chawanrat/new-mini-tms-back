export const getPositiveInteger = (value, fallback, maximum = Number.MAX_SAFE_INTEGER) => {
  const number = Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, maximum);
};

export const getPagination = (
  pageValue,
  limitValue,
  { defaultLimit = 20, maxLimit = 100 } = {},
) => {
  const page = getPositiveInteger(pageValue, 1);
  const limit = getPositiveInteger(limitValue, defaultLimit, maxLimit);

  return {
    page,
    limit,
    offset: (page - 1) * limit,
  };
};

export const getPaginationParams = (
  req,
  defaultPageSize = 100,
  maxPageSize = 200,
) => {
  const { page, limit: pageSize, offset: skip } = getPagination(
    req.query.page,
    req.query.pageSize,
    { defaultLimit: defaultPageSize, maxLimit: maxPageSize },
  );

  return { page, pageSize, skip };
};
