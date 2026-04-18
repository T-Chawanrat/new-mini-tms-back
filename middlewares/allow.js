// middlewares/allow.js
export const allow = (...roles) => {
  return (req, res, next) => {
    // รองรับ header / body / query
    const role_id =
      req.headers["role_id"] ||
      req.body?.role_id ||
      req.query?.role_id;

    if (!role_id) {
      return res.status(403).json({
        message: "ไม่มี role_id",
      });
    }

    if (!roles.includes(Number(role_id))) {
      return res.status(403).json({
        message: "ไม่มีสิทธิ์ใช้งาน",
      });
    }

    next();
  };
};