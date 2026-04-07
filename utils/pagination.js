






export const getPaginationParams = (req, defaultPageSize = 100, maxPageSize = 200) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const pageSizeRaw = parseInt(req.query.pageSize, 10);
  const pageSize = Math.min(Math.max(pageSizeRaw || defaultPageSize, 1), maxPageSize);

  const skip = (page - 1) * pageSize;
  return { page, pageSize, skip };
};
