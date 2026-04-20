// middlewares/allow.js
export const allow = (...roles) => {
  return (req, res, next) => {
    // 🔥 ใช้ token เท่านั้น
    const role_id = req.user?.role_id;

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