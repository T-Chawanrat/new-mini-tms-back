import jwt from "jsonwebtoken";

import db from "../config/db.js";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";

export const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ message: "no token" });
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return res.status(401).json({ message: "invalid token format" });
    }

    const decoded = jwt.verify(parts[1], JWT_SECRET);
    const userId = Number(decoded.id);
    const warehouseId = Number(decoded.warehouse_id);

    if (
      decoded.purpose !== "ACCESS" ||
      !Number.isInteger(userId) ||
      userId <= 0 ||
      !Number.isInteger(warehouseId) ||
      warehouseId <= 0
    ) {
      return res.status(401).json({ message: "invalid access token" });
    }

    const [rows] = await db.query(
      `
        SELECT app_user.id
        FROM um_users app_user
        INNER JOIN um_user_warehouses user_warehouse
          ON user_warehouse.user_id = app_user.id
        WHERE app_user.id = ?
          AND app_user.is_active = 1
          AND user_warehouse.warehouse_id = ?
          AND user_warehouse.is_active = 1
        LIMIT 1
      `,
      [userId, warehouseId],
    );

    if (!rows.length) {
      return res.status(401).json({ message: "warehouse access denied" });
    }

    req.user = decoded;
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "token expired" });
    }

    if (error.name === "JsonWebTokenError" || error.name === "NotBeforeError") {
      return res.status(401).json({ message: "invalid token" });
    }

    console.error("auth middleware error:", error);
    return res.status(500).json({ message: "ไม่สามารถตรวจสอบสิทธิ์ผู้ใช้งานได้" });
  }
};
