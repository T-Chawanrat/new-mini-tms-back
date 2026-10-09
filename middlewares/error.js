export const error = (error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const requestedStatus = Number(error?.statusCode || error?.status);
  const statusCode = requestedStatus >= 400 && requestedStatus < 600 ? requestedStatus : 500;

  console.error("Unhandled request error:", error);

  return res.status(statusCode).json({
    success: false,
    message: statusCode === 500 ? "เกิดข้อผิดพลาดในระบบ" : error.message,
  });
};
