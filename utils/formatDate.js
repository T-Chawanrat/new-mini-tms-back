exports.formatDate = (dateString) => {
  const dt = new Date(dateString);
  dt.setHours(dt.getHours() + 7);
  return dt.toISOString().replace("T", " ").slice(0, 19);
};
