import db from "../config/db.js";
import { formatDateOnly } from "../utils/formatDate.js";
import { buildLike } from "../utils/cleanText.js";

// GET ALL USERS
export const getUsers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { role_id, is_active, search } = req.query;

    const currentRole = req.user.role_id;

    let sql = `
      SELECT 
        u.id,
        u.username,
        u.first_name,
        u.last_name,
        u.role_id,
        r.name AS role_name,
        u.customer_id,
        u.warehouse_id,
        w.name AS warehouse_name,
        u.is_active,
        u.license_no,
        u.license_expire,
        u.last_login,
        u.created_at
      FROM um_users u
      LEFT JOIN mm_roles r ON u.role_id = r.id
      LEFT JOIN mm_warehouses w ON u.warehouse_id = w.id
      WHERE 1=1
    `;

    const params = [];

    let allowedRoles = null;

    if (currentRole === 9) {
      allowedRoles = [3, 4, 5, 6, 7, 8, 9];
    } else if (currentRole === 10) {
      allowedRoles = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    }

    if (allowedRoles) {
      sql += ` AND u.role_id IN (${allowedRoles.map(() => "?").join(",")})`;
      params.push(...allowedRoles);
    }

    if (role_id !== undefined) {
      const roleNum = Number(role_id);

      if (allowedRoles && !allowedRoles.includes(roleNum)) {
        return res.json([]);
      }

      sql += ` AND u.role_id = ?`;
      params.push(roleNum);
    }

    if (is_active !== undefined) {
      sql += ` AND u.is_active = ?`;
      params.push(is_active);
    }

    if (search) {
      sql += `
        AND (
          ${buildLike("u.username", search)}
          OR ${buildLike("u.first_name", search)}
          OR ${buildLike("u.last_name", search)}
        )
      `;
    }

    sql += ` ORDER BY u.id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("❌ GET USERS ERROR:", err);
    console.error("STACK:", err.stack);

    res.status(500).json({ message: err.message });
  }
};

export const createUser = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { username, password, first_name, last_name, role_id, customer_id, warehouse_id, license_no, license_expire, zones = [] } = req.body;

    const role = Number(role_id);

    if (!username || !password) {
      return res.status(400).json({
        message: "username/password required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [exists] = await connection.query(`SELECT id FROM um_users WHERE username = ? LIMIT 1`, [username]);

    if (exists.length > 0) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "username นี้มีในระบบแล้ว",
      });
    }

    const formattedLicenseExpire = formatDateOnly(license_expire);

    if (role === 7 && (!license_no || !formattedLicenseExpire)) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "driver ต้องมี license_no และ license_expire",
      });
    }

    if (role === 3 && zones.length === 0) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "manager ต้องเลือก zone อย่างน้อย 1",
      });
    }

    let finalWarehouse = null;

    if ([3, 4, 9, 10].includes(role)) {
      finalWarehouse = null;
    } else if (role === 6) {
      finalWarehouse = 15;
    } else {
      finalWarehouse = warehouse_id || null;
    }

    const [result] = await connection.query(
      `
      INSERT INTO um_users (
        username, password, first_name, last_name,
        role_id, customer_id, warehouse_id,
        license_no, license_expire, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      `,
      [
        username,
        password,
        first_name || null,
        last_name || null,
        role,
        customer_id || null,
        finalWarehouse,
        role === 7 ? license_no : null,
        role === 7 ? formattedLicenseExpire : null,
      ],
    );

    const userId = result.insertId;

    if (role === 3 && zones.length > 0) {
      const values = zones.map((z) => [userId, z]);

      await connection.query(`INSERT INTO um_user_zones (user_id, zone_id) VALUES ?`, [values]);
    }

    await connection.commit();
    connection.release();

    res.json({
      message: "create success",
      id: userId,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    console.error("CREATE USER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateUser = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const { first_name, last_name, license_no, license_expire, is_active } = req.body;

    if (!id) {
      return res.status(400).json({ message: "id required" });
    }

    // เปลี่ยนสถานะ Active / Inactive
    if (is_active !== undefined) {
      await db.query(
        `
        UPDATE um_users
        SET is_active = ?
        WHERE id = ?
        `,
        [is_active, id],
      );

      return res.json({ message: "update status success" });
    }

    await db.query(
      `
      UPDATE um_users SET
        first_name = ?,
        last_name = ?,
        license_no = ?,
        license_expire = ?
      WHERE id = ?
      `,
      [first_name || null, last_name || null, license_no || null, license_expire || null, id],
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteUserHard = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(`DELETE FROM um_user_zones WHERE user_id = ?`, [id]);
    await connection.query(`DELETE FROM um_user_vehicles WHERE user_id = ?`, [id]);

    const [result] = await connection.query(`DELETE FROM um_users WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "user not found",
      });
    }

    await connection.commit();
    connection.release();

    res.json({ message: "hard delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

/* ================= VEHICLES ================= */

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

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createVehicle = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    let {
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

    if (!license_plate) {
      return res.status(400).json({ message: "license_plate required" });
    }

    const plate = license_plate.toString().trim().toUpperCase().replace(/\s+/g, "").replace(/-/g, "");

    if (plate.length < 4) {
      return res.status(400).json({
        message: "ทะเบียนไม่ถูกต้อง",
      });
    }

    if (!brand_id) {
      return res.status(400).json({ message: "brand_id required" });
    }

    if (!vehicle_type_id) {
      return res.status(400).json({ message: "vehicle_type_id required" });
    }

    if (capacity_kg === undefined || capacity_kg === "") {
      return res.status(400).json({ message: "capacity required" });
    }

    if (isNaN(Number(capacity_kg))) {
      return res.status(400).json({ message: "capacity must be number" });
    }

    if (max_load_kg !== undefined && max_load_kg !== "" && isNaN(Number(max_load_kg))) {
      return res.status(400).json({ message: "max_load_kg must be number" });
    }

    if (vehicle_year !== undefined && vehicle_year !== "" && isNaN(Number(vehicle_year))) {
      return res.status(400).json({ message: "vehicle_year must be number" });
    }

    const allowedOwnerType = ["COMPANY", "DRIVER"];
    const finalOwnerType = owner_type || "COMPANY";

    if (!allowedOwnerType.includes(finalOwnerType)) {
      return res.status(400).json({ message: "invalid owner_type" });
    }

    const finalCapacityKg = Number(capacity_kg);
    const finalMaxLoadKg = max_load_kg === undefined || max_load_kg === "" ? finalCapacityKg : Number(max_load_kg);

    const finalStatus = "ACTIVE";

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
        engine_no,
        status,
        is_deleted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        plate,
        license_province || null,
        brand_id || null,
        model || null,
        color || null,
        vehicle_year === undefined || vehicle_year === "" ? null : Number(vehicle_year),
        vehicle_type_id || null,
        fuel_type || null,
        finalCapacityKg,
        finalMaxLoadKg,
        warehouse_id || null,
        finalOwnerType,
        owner_name || null,
        purchase_date || null,
        fleet_card_no || null,
        chassis_no || null,
        engine_no || null,
        finalStatus,
        "N",
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

/* ================= CUSTOMER ================= */

export const createCustomer = async (req, res) => {
  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { code, name, tax_id, address, subdistrict_id, district_id, province_id, zip_code, tel, line, contact_name, contact_tel, email, type } =
      req.body;

    const customerType = type || "EXPRESS";

    const [result] = await db.query(
      `
      INSERT INTO mm_customers
      (
        code,
        name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel,
        is_active,
        line,
        contact_name,
        contact_tel,
        email,
        type,
        tax_id,
        import_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, 'STD')
    `,
      [
        code,
        name,
        address,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        line || null,
        contact_name,
        contact_tel,
        email || null,
        customerType,
        tax_id,
      ],
    );

    res.json({ message: "create success", id: result.insertId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateCustomer = async (req, res) => {
  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    const { code, name, tax_id, address, subdistrict_id, district_id, province_id, zip_code, tel, line, contact_name, contact_tel, email, type } =
      req.body;

    const customerType = type || "EXPRESS";

    await db.query(
      `
      UPDATE mm_customers SET
        code = ?,
        name = ?,
        address = ?,
        subdistrict_id = ?,
        district_id = ?,
        province_id = ?,
        zip_code = ?,
        tel = ?,
        line = ?,
        contact_name = ?,
        contact_tel = ?,
        email = ?,
        type = ?,
        import_type = 'STD',
        tax_id = ?
      WHERE id = ?
    `,
      [
        code,
        name,
        address,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        line || null,
        contact_name,
        contact_tel,
        email || null,
        customerType,
        tax_id,
        id,
      ],
    );

    res.json({ message: "update success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const updateCustomerStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;
    const { is_active } = req.body;

    if (![0, 1, "0", "1", true, false].includes(is_active)) {
      return res.status(400).json({ message: "invalid status" });
    }

    const activeValue = Number(is_active) === 1 || is_active === true ? 1 : 0;

    await db.query(
      `
      UPDATE mm_customers
      SET is_active = ?
      WHERE id = ?
      `,
      [activeValue, id],
    );

    res.json({ message: "update status success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const deleteCustomer = async (req, res) => {
  let connection;

  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [result] = await connection.query(`UPDATE mm_customers SET is_active = 0 WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "customer not found",
      });
    }

    await connection.query(`UPDATE um_users SET is_active = 0 WHERE customer_id = ?`, [id]);

    await connection.commit();
    connection.release();

    res.json({ message: "delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

export const deleteCustomerHard = async (req, res) => {
  let connection;

  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { id } = req.params;

    connection = await db.getConnection();
    await connection.beginTransaction();

    await connection.query(`DELETE FROM um_users WHERE customer_id = ?`, [id]);

    const [result] = await connection.query(`DELETE FROM mm_customers WHERE id = ?`, [id]);

    if (result.affectedRows === 0) {
      await connection.rollback();
      connection.release();

      return res.status(404).json({
        message: "customer not found",
      });
    }

    await connection.commit();
    connection.release();

    res.json({ message: "hard delete success" });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

export const createCustomerUser = async (req, res) => {
  let connection;

  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { username, password, first_name, last_name, customer_id } = req.body;

    if (!username || !password || !customer_id) {
      return res.status(400).json({
        message: "username / password / customer required",
      });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [exists] = await connection.query(`SELECT id FROM um_users WHERE username = ? LIMIT 1`, [username]);

    if (exists.length > 0) {
      await connection.rollback();
      connection.release();

      return res.status(400).json({
        message: "username นี้มีในระบบแล้ว",
      });
    }

    const CUSTOMER_ROLE = 2;

    const [result] = await connection.query(
      `
      INSERT INTO um_users (
        username, password, first_name, last_name,
        role_id, customer_id, warehouse_id,
        license_no, license_expire, is_active
      )
      VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 1)
      `,
      [username, password, first_name || null, last_name || null, CUSTOMER_ROLE, customer_id],
    );

    await connection.commit();
    connection.release();

    res.json({
      message: "create customer user success",
      id: result.insertId,
    });
  } catch (err) {
    if (connection) await connection.rollback();
    if (connection) connection.release();

    res.status(500).json({ message: err.message });
  }
};

/* ================= SHIPPERS ================= */
export const getShippers = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const customerIdParam = req.params.customer_id;
    const { customer_id, search } = req.query;

    let sql = `
      SELECT
        s.shipper_id,
        s.shipper_code,
        s.shipper_type_id,
        st.name AS shipper_type_name,
        s.shipper_name,
        s.address,

        s.subdistrict_id,
        s.district_id,
        s.province_id,
        s.zip_code,

        a.subdistrict_name,
        a.district_name,
        a.province_name,

        s.tel,
        s.fax,
        s.customer_id,
        c.code AS customer_code,
        c.name AS customer_name,
        s.is_deleted

      FROM mm_shippers s

      LEFT JOIN mm_shipper_types st
        ON st.id = s.shipper_type_id

      LEFT JOIN mm_customers c 
        ON c.id = s.customer_id

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = s.subdistrict_id
        AND a.district_id = s.district_id
        AND a.province_id = s.province_id

      WHERE 1=1
    `;

    const params = [];

    if (Number(req.user.role_id) === 2) {
      sql += ` AND s.customer_id = ?`;
      params.push(req.user.customer_id);
    } else if (customerIdParam) {
      sql += ` AND s.customer_id = ?`;
      params.push(customerIdParam);
    } else if (customer_id) {
      sql += ` AND s.customer_id = ?`;
      params.push(customer_id);
    }

    if (search) {
      sql += `
        AND (
          ${buildLike("s.shipper_code", search)}
          OR ${buildLike("s.shipper_name", search)}
          OR ${buildLike("s.tel", search)}
          OR ${buildLike("s.zip_code", search)}
          OR ${buildLike("a.subdistrict_name", search)}
          OR ${buildLike("a.district_name", search)}
          OR ${buildLike("a.province_name", search)}
          OR ${buildLike("c.code", search)}
          OR ${buildLike("c.name", search)}
          OR ${buildLike("st.name", search)}
        )
      `;
    }

    sql += ` ORDER BY s.shipper_id DESC`;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("GET SHIPPERS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createShipper = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;

    const { shipper_code, shipper_type_id, shipper_name, address, subdistrict_id, district_id, province_id, zip_code, tel, fax } = req.body;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id required" });
    }

    // CUSTOMER สร้างได้เฉพาะ customer_id ของตัวเอง
    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({ message: "customer user has no customer_id" });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    if (!shipper_code || !shipper_name) {
      return res.status(400).json({
        message: "shipper_code / shipper_name required",
      });
    }

    const [customerRows] = await db.query(
      `
      SELECT id
      FROM mm_customers
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [customer_id],
    );

    if (customerRows.length === 0) {
      return res.status(400).json({
        message: "customer not found or inactive",
      });
    }

    const [exists] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE customer_id = ?
        AND shipper_code = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, shipper_code],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "shipper_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_shippers (
        shipper_code,
        shipper_type_id,
        shipper_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel,
        fax,
        customer_id,
        is_deleted
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N')
      `,
      [
        shipper_code,
        shipper_type_id || null,
        shipper_name,
        address || null,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        fax || null,
        customer_id,
      ],
    );

    res.json({
      message: "create shipper success",
      id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE SHIPPER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateShipper = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const {
      shipper_code,
      shipper_type_id,
      shipper_name,
      address,
      subdistrict_id,
      district_id,
      province_id,
      zip_code,
      tel,
      fax,
      longitude,
      latitude,
      priority,
    } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({ message: "customer_id / id required" });
    }

    // CUSTOMER แก้ได้เฉพาะ customer_id ของตัวเอง
    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    if (!shipper_code || !shipper_name) {
      return res.status(400).json({
        message: "shipper_code / shipper_name required",
      });
    }

    const [exists] = await db.query(
      `
      SELECT shipper_id
      FROM mm_shippers
      WHERE customer_id = ?
        AND shipper_code = ?
        AND shipper_id <> ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, shipper_code, id],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "shipper_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      UPDATE mm_shippers SET
        shipper_code = ?,
        shipper_type_id = ?,
        shipper_name = ?,
        address = ?,
        subdistrict_id = ?,
        district_id = ?,
        province_id = ?,
        zip_code = ?,
        tel = ?,
        fax = ?,
        longitude = ?,
        latitude = ?,
        priority = ?
      WHERE shipper_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      `,
      [
        shipper_code,
        shipper_type_id || null,
        shipper_name,
        address || null,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel || null,
        fax || null,
        longitude || null,
        latitude || null,
        priority || 0,
        id,
        customer_id,
      ],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "shipper not found" });
    }

    res.json({ message: "update shipper success" });
  } catch (err) {
    console.error("UPDATE SHIPPER ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateShipperStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customerId, shipperId } = req.params;
    const { is_deleted } = req.body;

    if (!["N", "Y"].includes(is_deleted)) {
      return res.status(400).json({ message: "invalid status" });
    }

    await db.query(
      `
      UPDATE mm_shippers
      SET is_deleted = ?
      WHERE shipper_id = ?
        AND customer_id = ?
      `,
      [is_deleted, shipperId, customerId],
    );

    res.json({ message: "update status success" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

/* ================= RECIPIENTS ================= */

export const getRecipients = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;
    const { search } = req.query;

    const isCustomer = Number(req.user.role_id) === 2;

    if (isCustomer && !req.user.customer_id) {
      return res.status(403).json({
        message: "customer user has no customer_id",
      });
    }

    if (!isCustomer && !customer_id) {
      return res.json([]);
    }

    let sql = `
      SELECT
        r.recipient_id,
        r.recipient_code,
        r.recipient_type_id,
        rt.name AS recipient_type_name,
        r.recipient_name,
        r.customer_id AS recipient_customer_id,
        r.is_deleted AS recipient_is_deleted,

        c.id AS customer_id,
        c.code AS customer_code,
        c.name AS customer_name,

        rd.recipient_detail_id,
        rd.recipient_detail_name,
        rd.address,
        rd.subdistrict_id,
        rd.district_id,
        rd.province_id,
        rd.zip_code,
        rd.tel1,
        rd.tel1_ext,
        rd.tel2,
        rd.tel2_ext,
        rd.is_deleted AS detail_is_deleted,
        rd.line_id,
        rd.longitude,
        rd.latitude,

        a.subdistrict_name,
        a.district_name,
        a.province_name,

        COUNT(
          CASE 
            WHEN rd.recipient_detail_id IS NOT NULL 
            THEN 1 
          END
        ) OVER (
          PARTITION BY r.recipient_id
        ) AS address_count

      FROM mm_recipients r

      LEFT JOIN mm_customers c
        ON c.id = r.customer_id

      LEFT JOIN mm_recipient_types rt
        ON rt.id = r.recipient_type_id
        AND rt.is_deleted = 'N'

      LEFT JOIN mm_recipient_details rd
        ON rd.recipient_id = r.recipient_id

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = rd.subdistrict_id
        AND a.district_id = rd.district_id
        AND a.province_id = rd.province_id

      WHERE 1 = 1
        AND r.is_deleted = 'N'
    `;

    const params = [];

    if (isCustomer) {
      sql += ` AND r.customer_id = ? `;
      params.push(req.user.customer_id);
    }

    if (!isCustomer && customer_id) {
      sql += ` AND r.customer_id = ? `;
      params.push(customer_id);
    }

    if (search) {
      sql += `
        AND (
          ${buildLike("r.recipient_code", search)}
          OR ${buildLike("r.recipient_name", search)}
          OR ${buildLike("rt.name", search)}
          OR ${buildLike("rd.recipient_detail_name", search)}
          OR ${buildLike("rd.address", search)}
          OR ${buildLike("rd.tel1", search)}
          OR ${buildLike("rd.tel2", search)}
          OR ${buildLike("rd.zip_code", search)}
          OR ${buildLike("rd.line_id", search)}
          OR ${buildLike("a.subdistrict_name", search)}
          OR ${buildLike("a.district_name", search)}
          OR ${buildLike("a.province_name", search)}
          OR ${buildLike("c.code", search)}
          OR ${buildLike("c.name", search)}
        )
      `;
    }

    sql += `
      ORDER BY
        r.recipient_id DESC,
        CASE WHEN rd.is_deleted = 'N' THEN 0 ELSE 1 END,
        rd.recipient_detail_id ASC

      LIMIT 1000
    `;

    const [rows] = await db.query(sql, params);

    res.json(rows);
  } catch (err) {
    console.error("GET RECIPIENTS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createRecipient = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id } = req.params;

    const { recipient_code, recipient_type_id, recipient_name } = req.body;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id required" });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    if (!recipient_code || !recipient_name) {
      return res.status(400).json({
        message: "recipient_code / recipient_name required",
      });
    }

    const [customerRows] = await db.query(
      `
      SELECT id
      FROM mm_customers
      WHERE id = ?
        AND is_active = 1
      LIMIT 1
      `,
      [customer_id],
    );

    if (customerRows.length === 0) {
      return res.status(400).json({
        message: "customer not found or inactive",
      });
    }

    const [exists] = await db.query(
      `
      SELECT recipient_id
      FROM mm_recipients
      WHERE customer_id = ?
        AND recipient_code = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [customer_id, recipient_code],
    );

    if (exists.length > 0) {
      return res.status(400).json({
        message: "recipient_code นี้มีใน customer นี้แล้ว",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_recipients (
        recipient_code,
        recipient_type_id,
        recipient_name,
        customer_id,
        is_deleted
      )
      VALUES (?, ?, ?, ?, 'N')
      `,
      [recipient_code, recipient_type_id || null, recipient_name, customer_id],
    );

    res.json({
      message: "create recipient success",
      recipient_id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE RECIPIENT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const createRecipientDetail = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const {
      recipient_detail_name,
      address,
      subdistrict_id,
      district_id,
      province_id,
      zip_code,
      tel1,
      tel1_ext,
      tel2,
      tel2_ext,
      line_id,
      longitude,
      latitude,
    } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({
        message: "customer_id / recipient_id required",
      });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    if (!recipient_detail_name || !address || !tel1) {
      return res.status(400).json({
        message: "recipient_detail_name / address / tel1 required",
      });
    }

    if (!subdistrict_id || !district_id || !province_id) {
      return res.status(400).json({
        message: "subdistrict_id / district_id / province_id required",
      });
    }

    const [recipientRows] = await db.query(
      `
      SELECT recipient_id
      FROM mm_recipients
      WHERE recipient_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id, customer_id],
    );

    if (recipientRows.length === 0) {
      return res.status(404).json({
        message: "recipient not found",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_recipient_details (
        recipient_id,
        recipient_detail_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel1,
        tel1_ext,
        tel2,
        tel2_ext,
        is_deleted,
        is_default,
        line_id,
        longitude,
        latitude
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', 'N', ?, ?, ?)
      `,
      [
        id,
        recipient_detail_name,
        address,
        subdistrict_id || null,
        district_id || null,
        province_id || null,
        zip_code || null,
        tel1,
        tel1_ext || null,
        tel2 || null,
        tel2_ext || null,
        line_id || null,
        longitude || null,
        latitude || null,
      ],
    );

    res.json({
      message: "create recipient detail success",
      recipient_detail_id: result.insertId,
    });
  } catch (err) {
    console.error("CREATE RECIPIENT DETAIL ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateRecipient = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customer_id, id } = req.params;

    const { mode = "recipient", recipient_code, recipient_type_id, recipient_name, detail = {} } = req.body;

    if (!customer_id || !id) {
      return res.status(400).json({ message: "customer_id / id required" });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customer_id) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    const [recipientRows] = await db.query(
      `
      SELECT recipient_id
      FROM mm_recipients
      WHERE recipient_id = ?
        AND customer_id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id, customer_id],
    );

    if (recipientRows.length === 0) {
      return res.status(404).json({ message: "recipient not found" });
    }

    if (mode === "recipient") {
      if (!recipient_code || !recipient_name) {
        return res.status(400).json({
          message: "recipient_code / recipient_name required",
        });
      }

      const [exists] = await db.query(
        `
        SELECT recipient_id
        FROM mm_recipients
        WHERE customer_id = ?
          AND recipient_code = ?
          AND recipient_id <> ?
          AND is_deleted = 'N'
        LIMIT 1
        `,
        [customer_id, recipient_code, id],
      );

      if (exists.length > 0) {
        return res.status(400).json({
          message: "recipient_code นี้มีใน customer นี้แล้ว",
        });
      }

      const [result] = await db.query(
        `
        UPDATE mm_recipients SET
          recipient_code = ?,
          recipient_type_id = ?,
          recipient_name = ?
        WHERE recipient_id = ?
          AND customer_id = ?
          AND is_deleted = 'N'
        `,
        [recipient_code, recipient_type_id || null, recipient_name, id, customer_id],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "recipient not found" });
      }

      return res.json({ message: "update recipient success" });
    }

    if (mode === "detail") {
      const {
        recipient_detail_id,
        recipient_detail_name,
        address,
        subdistrict_id,
        district_id,
        province_id,
        zip_code,
        tel1,
        tel1_ext,
        tel2,
        tel2_ext,
        line_id,
        longitude,
        latitude,
      } = detail;

      if (!recipient_detail_id) {
        return res.status(400).json({
          message: "recipient_detail_id required",
        });
      }

      if (!recipient_detail_name || !address || !tel1) {
        return res.status(400).json({
          message: "recipient_detail_name / address / tel1 required",
        });
      }

      if (!subdistrict_id || !district_id || !province_id) {
        return res.status(400).json({
          message: "subdistrict_id / district_id / province_id required",
        });
      }

      const [result] = await db.query(
        `
        UPDATE mm_recipient_details SET
          recipient_detail_name = ?,
          address = ?,
          subdistrict_id = ?,
          district_id = ?,
          province_id = ?,
          zip_code = ?,
          tel1 = ?,
          tel1_ext = ?,
          tel2 = ?,
          tel2_ext = ?,
          line_id = ?,
          longitude = ?,
          latitude = ?
        WHERE recipient_detail_id = ?
          AND recipient_id = ?
        `,
        [
          recipient_detail_name,
          address,
          subdistrict_id || null,
          district_id || null,
          province_id || null,
          zip_code || null,
          tel1,
          tel1_ext || null,
          tel2 || null,
          tel2_ext || null,
          line_id || null,
          longitude || null,
          latitude || null,
          recipient_detail_id,
          id,
        ],
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          message: "recipient detail not found",
        });
      }

      return res.json({ message: "update recipient detail success" });
    }

    return res.status(400).json({
      message: "invalid update mode",
    });
  } catch (err) {
    console.error("UPDATE RECIPIENT ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

export const updateRecipientDetailStatus = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { customerId, recipientId, detailId } = req.params;
    const { is_deleted } = req.body;

    if (!["N", "Y"].includes(is_deleted)) {
      return res.status(400).json({ message: "invalid status" });
    }

    if (!customerId || !recipientId || !detailId) {
      return res.status(400).json({
        message: "customerId / recipientId / detailId required",
      });
    }

    if (Number(req.user.role_id) === 2) {
      if (!req.user.customer_id) {
        return res.status(403).json({
          message: "customer user has no customer_id",
        });
      }

      if (String(customerId) !== String(req.user.customer_id)) {
        return res.status(403).json({ message: "forbidden" });
      }
    }

    const [result] = await db.query(
      `
      UPDATE mm_recipient_details rd
      INNER JOIN mm_recipients r
        ON r.recipient_id = rd.recipient_id
      SET rd.is_deleted = ?
      WHERE rd.recipient_detail_id = ?
        AND rd.recipient_id = ?
        AND r.customer_id = ?
        AND r.is_deleted = 'N'
      `,
      [is_deleted, detailId, recipientId, customerId],
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "recipient detail not found",
      });
    }

    res.json({ message: "update recipient detail status success" });
  } catch (err) {
    console.error("UPDATE RECIPIENT DETAIL STATUS ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};
