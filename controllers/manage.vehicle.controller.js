import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";
import { normalizePlate, isValidPlate } from "../utils/plate.js";
import { formatDateOnly } from "../utils/formatDate.js";

export const getVehicles = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { search, vehicle_type_id, status, owner_type } = req.query;

    let sql = `
      SELECT
        v.id,
        v.license_plate,
        v.license_province,

        v.brand_id,
        b.name AS brand_name,

        v.model,
        v.color,
        v.vehicle_year,

        v.vehicle_type_id,
        vt.name AS vehicle_type_name,

        v.fuel_type,
        v.capacity_kg,
        v.max_load_kg,

        v.warehouse_id,
        w.name AS warehouse_name,

        v.owner_type,
        v.owner_name,
        v.purchase_date,
        v.fleet_card_no,
        v.chassis_no,
        v.engine_no,

        v.status,
        v.is_deleted,
        v.created_at,
        v.updated_at
      FROM mm_vehicles v
      LEFT JOIN mm_vehicle_brands b
        ON b.id = v.brand_id
      LEFT JOIN mm_vehicle_types vt
        ON vt.id = v.vehicle_type_id
      LEFT JOIN mm_warehouses w
        ON w.id = v.warehouse_id
      WHERE v.is_deleted = 'N'
    `;

    const params = [];

    if (search) {
      sql += `
        AND (
          ${buildLike("v.license_plate", search)}
          OR ${buildLike("v.license_province", search)}
          OR ${buildLike("b.name", search)}
          OR ${buildLike("v.model", search)}
          OR ${buildLike("v.color", search)}
          OR ${buildLike("vt.name", search)}
          OR ${buildLike("v.owner_name", search)}
          OR ${buildLike("v.fleet_card_no", search)}
          OR ${buildLike("v.chassis_no", search)}
          OR ${buildLike("v.engine_no", search)}
          OR ${buildLike("w.name", search)}
        )
      `;
    }

    if (vehicle_type_id) {
      sql += ` AND v.vehicle_type_id = ?`;
      params.push(vehicle_type_id);
    }

    if (status) {
      sql += ` AND v.status = ?`;
      params.push(status);
    }

    if (owner_type) {
      sql += ` AND v.owner_type = ?`;
      params.push(owner_type);
    }

    sql += ` ORDER BY v.id DESC`;

    const [rows] = await db.query(sql, params);

    const data = rows.map((row) => ({
      ...row,
      purchase_date: formatDateOnly(row.purchase_date),
    }));

    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createVehicle = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const {
      license_plate,
      license_province,
      brand_id,
      model,
      color,
      vehicle_year,
      vehicle_type_id,
      fuel_type,
      capacity_kg,
      max_load_kg,
      warehouse_id,
      owner_type,
      owner_name,
      purchase_date,
      fleet_card_no,
      chassis_no,
      engine_no,
    } = req.body;

    const plate = normalizePlate(license_plate);

    if (!plate) {
      return res.status(400).json({ message: "license_plate required" });
    }

    if (!isValidPlate(plate)) {
      return res.status(400).json({ message: "ทะเบียนไม่ถูกต้อง" });
    }

    if (!license_province) {
      return res.status(400).json({ message: "license_province required" });
    }

    if (!brand_id) {
      return res.status(400).json({ message: "brand_id required" });
    }

    if (!vehicle_type_id) {
      return res.status(400).json({ message: "vehicle_type_id required" });
    }

    if (!capacity_kg) {
      return res.status(400).json({ message: "capacity_kg required" });
    }

    if (!warehouse_id) {
      return res.status(400).json({ message: "warehouse_id required" });
    }

    if (!owner_type) {
      return res.status(400).json({ message: "owner_type required" });
    }

    const allowedOwnerType = ["COMPANY", "DRIVER"];

    if (!allowedOwnerType.includes(owner_type)) {
      return res.status(400).json({ message: "invalid owner_type" });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_vehicles (
        license_plate,
        license_province,
        brand_id,
        model,
        color,
        vehicle_year,
        vehicle_type_id,
        fuel_type,
        capacity_kg,
        max_load_kg,
        warehouse_id,
        owner_type,
        owner_name,
        purchase_date,
        fleet_card_no,
        chassis_no,
        engine_no
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        plate,
        license_province || null,
        brand_id,
        model || null,
        color || null,
        vehicle_year || null,
        vehicle_type_id,
        fuel_type || null,
        capacity_kg,
        max_load_kg || null,
        warehouse_id,
        owner_type,
        owner_type === "DRIVER" ? owner_name || null : null,
        owner_type === "COMPANY" ? purchase_date || null : null,
        fleet_card_no || null,
        chassis_no || null,
        engine_no || null,
      ],
    );

    res.json({ message: "create success", id: result.insertId });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "ข้อมูลรถซ้ำในระบบ",
      });
    }

    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({
        message: "brand_id, vehicle_type_id หรือ warehouse_id ไม่ถูกต้อง",
      });
    }

    res.status(500).json({ message: err.message });
  }
};

export const updateVehicle = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const {
      license_plate,
      license_province,
      brand_id,
      model,
      color,
      vehicle_year,
      vehicle_type_id,
      fuel_type,
      capacity_kg,
      max_load_kg,
      warehouse_id,
      owner_type,
      owner_name,
      purchase_date,
      fleet_card_no,
      chassis_no,
      engine_no,
    } = req.body;

    const plate = normalizePlate(license_plate);

    if (!plate) {
      return res.status(400).json({ message: "license_plate required" });
    }

    if (!isValidPlate(plate)) {
      return res.status(400).json({ message: "ทะเบียนไม่ถูกต้อง" });
    }

    if (!license_province) {
      return res.status(400).json({ message: "license_province required" });
    }

    if (!brand_id) {
      return res.status(400).json({ message: "brand_id required" });
    }

    if (!vehicle_type_id) {
      return res.status(400).json({ message: "vehicle_type_id required" });
    }

    if (!capacity_kg) {
      return res.status(400).json({ message: "capacity_kg required" });
    }

    if (!warehouse_id) {
      return res.status(400).json({ message: "warehouse_id required" });
    }

    if (!owner_type) {
      return res.status(400).json({ message: "owner_type required" });
    }

    const allowedOwnerType = ["COMPANY", "DRIVER"];

    if (!allowedOwnerType.includes(owner_type)) {
      return res.status(400).json({ message: "invalid owner_type" });
    }

    const [result] = await db.query(
      `
      UPDATE mm_vehicles
      SET
        license_plate = ?,
        license_province = ?,
        brand_id = ?,
        model = ?,
        color = ?,
        vehicle_year = ?,
        vehicle_type_id = ?,
        fuel_type = ?,
        capacity_kg = ?,
        max_load_kg = ?,
        warehouse_id = ?,
        owner_type = ?,
        owner_name = ?,
        purchase_date = ?,
        fleet_card_no = ?,
        chassis_no = ?,
        engine_no = ?
      WHERE id = ?
        AND is_deleted = 'N'
      `,
      [
        plate,
        license_province || null,
        brand_id,
        model || null,
        color || null,
        vehicle_year || null,
        vehicle_type_id,
        fuel_type || null,
        capacity_kg,
        max_load_kg || null,
        warehouse_id,
        owner_type,
        owner_type === "DRIVER" ? owner_name || null : null,
        owner_type === "COMPANY" ? purchase_date || null : null,
        fleet_card_no || null,
        chassis_no || null,
        engine_no || null,
        id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "vehicle not found" });
    }

    res.json({ message: "update success" });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(400).json({
        message: "ข้อมูลรถซ้ำในระบบ",
      });
    }

    if (err.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(400).json({
        message: "brand_id, vehicle_type_id หรือ warehouse_id ไม่ถูกต้อง",
      });
    }

    res.status(500).json({ message: err.message });
  }
};

export const updateVehicleStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;
    const { status } = req.body;

    const allowedStatus = ["ACTIVE", "MAINTENANCE", "INACTIVE"];

    if (!allowedStatus.includes(status)) {
      return res.status(400).json({ message: "invalid status" });
    }

    const [result] = await db.query(
      `
      UPDATE mm_vehicles
      SET status = ?
      WHERE id = ?
        AND is_deleted = 'N'
      `,
      [status, id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "vehicle not found" });
    }

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteVehicle = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const [result] = await db.query(
      `
      UPDATE mm_vehicles
      SET is_deleted = 'Y'
      WHERE id = ?
      `,
      [id],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "vehicle not found" });
    }

    res.json({ message: "delete success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
