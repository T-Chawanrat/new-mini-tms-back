import db from "../config/db.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const MANAGER_ROLE_ID = 3;
const DRIVER_ROLE_ID = 7;

const getUserWarehouses = async (userId) => {
  const [rows] = await db.query(
    `
      SELECT
        user_warehouse.warehouse_id,
        warehouse.warehouse_name
      FROM um_user_warehouses user_warehouse
      INNER JOIN mm_warehouses_to warehouse
        ON warehouse.warehouse_id = user_warehouse.warehouse_id
      WHERE user_warehouse.user_id = ?
        AND user_warehouse.is_active = 1
      ORDER BY warehouse.warehouse_name ASC
    `,
    [userId],
  );

  return rows;
};

const getUserExtras = async (user) => {
  let zones = [];
  let vehicles = [];

  if (Number(user.role_id) === MANAGER_ROLE_ID) {
    const [zoneRows] = await db.query(
      `
        SELECT zone.id, zone.zone_name
        FROM um_user_zones user_zone
        INNER JOIN mm_zones zone
          ON zone.id = user_zone.zone_id
        WHERE user_zone.user_id = ?
      `,
      [user.id],
    );
    zones = zoneRows;
  }

  if (Number(user.role_id) === DRIVER_ROLE_ID) {
    const [vehicleRows] = await db.query(
      `
        SELECT vehicle.id, vehicle.license_plate
        FROM um_user_vehicles user_vehicle
        INNER JOIN mm_vehicles vehicle
          ON vehicle.id = user_vehicle.vehicle_id
        WHERE user_vehicle.user_id = ?
          AND user_vehicle.unassigned_at IS NULL
      `,
      [user.id],
    );
    vehicles = vehicleRows;
  }

  return { zones, vehicles };
};

export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "กรุณากรอก username และ password" });
    }

    const [rows] = await db.query(
      `
        SELECT
          id,
          username,
          password,
          first_name,
          last_name,
          role_id,
          customer_id,
          license_no,
          license_expire,
          last_login
        FROM um_users
        WHERE username = ?
          AND is_active = 1
        LIMIT 1
      `,
      [username],
    );

    if (!rows.length) {
      return res.status(404).json({ message: "ไม่พบบัญชีผู้ใช้นี้" });
    }

    const user = rows[0];

    if (password !== user.password) {
      return res.status(401).json({ message: "รหัสผ่านไม่ถูกต้อง" });
    }

    const warehouses = await getUserWarehouses(user.id);

    if (!warehouses.length) {
      return res.status(403).json({ message: "บัญชีนี้ยังไม่มีสิทธิ์เข้าใช้งาน Warehouse" });
    }

    const selectionToken = jwt.sign(
      {
        id: user.id,
        purpose: "WAREHOUSE_SELECTION",
      },
      JWT_SECRET,
      { expiresIn: "10m" },
    );

    return res.status(200).json({
      message: "กรุณาเลือก Warehouse",
      selection_required: true,
      selection_token: selectionToken,
      warehouses,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        customer_id: user.customer_id,
        license_no: user.license_no,
        license_expire: user.license_expire,
        last_login: user.last_login,
      },
    });
  } catch (error) {
    console.error("login error:", error);
    return res.status(500).json({ message: "ไม่สามารถเข้าสู่ระบบได้" });
  }
};

export const selectWarehouse = async (req, res) => {
  try {
    const selectionToken = String(req.body.selection_token || "").trim();
    const warehouseId = Number(req.body.warehouse_id);

    if (!selectionToken || !Number.isInteger(warehouseId) || warehouseId <= 0) {
      return res.status(400).json({ message: "ข้อมูล Warehouse ไม่ถูกต้อง" });
    }

    let decoded;

    try {
      decoded = jwt.verify(selectionToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "สิทธิ์เลือก Warehouse หมดอายุ กรุณา Login ใหม่" });
    }

    if (decoded.purpose !== "WAREHOUSE_SELECTION" || !decoded.id) {
      return res.status(401).json({ message: "Token สำหรับเลือก Warehouse ไม่ถูกต้อง" });
    }

    const [rows] = await db.query(
      `
        SELECT
          app_user.id,
          app_user.username,
          app_user.first_name,
          app_user.last_name,
          app_user.role_id,
          app_user.customer_id,
          app_user.license_no,
          app_user.license_expire,
          warehouse.warehouse_id,
          warehouse.warehouse_name
        FROM um_users app_user
        INNER JOIN um_user_warehouses user_warehouse
          ON user_warehouse.user_id = app_user.id
          AND user_warehouse.is_active = 1
        INNER JOIN mm_warehouses_to warehouse
          ON warehouse.warehouse_id = user_warehouse.warehouse_id
        WHERE app_user.id = ?
          AND app_user.is_active = 1
          AND user_warehouse.warehouse_id = ?
        LIMIT 1
      `,
      [decoded.id, warehouseId],
    );

    if (!rows.length) {
      return res.status(403).json({ message: "คุณไม่มีสิทธิ์เข้าใช้งาน Warehouse นี้" });
    }

    const user = rows[0];
    const { zones, vehicles } = await getUserExtras(user);

    const now = new Date();
    await db.query("UPDATE um_users SET last_login = ? WHERE id = ?", [now, user.id]);

    const token = jwt.sign(
      {
        id: user.id,
        role_id: user.role_id,
        customer_id: user.customer_id,
        warehouse_id: user.warehouse_id,
        purpose: "ACCESS",
      },
      JWT_SECRET,
      { expiresIn: "1d" },
    );

    return res.status(200).json({
      message: "เข้าสู่ระบบสำเร็จ",
      token,
      user: {
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        role_id: user.role_id,
        warehouse_id: user.warehouse_id,
        warehouse_name: user.warehouse_name,
        customer_id: user.customer_id,
        license_no: user.license_no,
        license_expire: user.license_expire,
        last_login: now,
        zones,
        vehicles,
      },
    });
  } catch (error) {
    console.error("selectWarehouse error:", error);
    return res.status(500).json({ message: "ไม่สามารถเลือก Warehouse ได้" });
  }
};
