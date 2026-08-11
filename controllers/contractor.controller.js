import db from "../config/db.js";

const CONTRACTOR_ROLE_ID = 7;

const textOrNull = (value) => {
  const text = String(value ?? "").trim();
  return text || null;
};

const positiveIdOrNull = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

export const getAvailableContractors = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
        SELECT
          contractor_vehicle.id AS vehicle_contractor_id,
          contractor_vehicle.user_truck_id,
          app_user.employee_code,
          app_user.first_name,
          app_user.last_name,
          app_user.tel,
          contractor_vehicle.license_plate,
          contractor_vehicle.license_plate_province_id,
          province.province_name AS license_plate_province,
          contractor_vehicle.brand_id,
          brand.name AS brand_name,
          contractor_vehicle.model,
          contractor_vehicle.color,
          contractor_vehicle.vehicle_type_id,
          vehicle_type.name AS vehicle_type_name,
          contractor_vehicle.max_load_kg
        FROM mm_vehicles_contractor contractor_vehicle
        INNER JOIN um_users app_user
          ON app_user.id = contractor_vehicle.user_truck_id
        LEFT JOIN mm_province province
          ON province.id = contractor_vehicle.license_plate_province_id
        LEFT JOIN mm_vehicle_brands brand
          ON brand.id = contractor_vehicle.brand_id
        LEFT JOIN mm_vehicle_types vehicle_type
          ON vehicle_type.id = contractor_vehicle.vehicle_type_id
        WHERE contractor_vehicle.is_deleted = 'N'
          AND app_user.role_id = 7
          AND app_user.employment_type = 'CONTRACTOR'
          AND app_user.is_active = 1
        ORDER BY contractor_vehicle.id DESC
      `,
    );

    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    console.error("getAvailableContractors error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const createContractor = async (req, res) => {
  let connection;
  let runningLockName = null;
  let hasRunningLock = false;

  try {
    const createdBy = Number(req.user?.id);
    const warehouseId = Number(req.user?.warehouse_id);
    const { user = {}, vehicle = {} } = req.body;

    const firstName = textOrNull(user.first_name);
    const lastName = textOrNull(user.last_name);
    const tel = textOrNull(user.tel);
    const licenseNo = textOrNull(user.license_no);
    const licenseExpire = textOrNull(user.license_expire);
    const licensePlate = textOrNull(vehicle.license_plate);
    const provinceId = positiveIdOrNull(vehicle.license_plate_province_id);

    if (!firstName || !lastName) {
      return res.status(400).json({
        message: "กรุณากรอกชื่อและนามสกุลคนขับ",
      });
    }

    if (!tel || !/^\d{9,10}$/.test(tel)) {
      return res.status(400).json({
        message: "กรุณากรอกเบอร์โทร 9-10 หลักสำหรับใช้เป็น password",
      });
    }

    if (!licenseNo || !licenseExpire) {
      return res.status(400).json({
        message: "กรุณากรอกเลขใบขับขี่และวันหมดอายุ",
      });
    }

    if (!licensePlate || !provinceId) {
      return res.status(400).json({
        message: "กรุณากรอกทะเบียนรถและเลือกจังหวัดทะเบียน",
      });
    }

    if (!Number.isInteger(createdBy) || !Number.isInteger(warehouseId)) {
      return res.status(401).json({ message: "ข้อมูลผู้ใช้งานหรือคลังไม่ถูกต้อง" });
    }

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [[dateRow]] = await connection.query(
      `SELECT DATE_FORMAT(CURDATE(), '%Y%m%d') AS date_code`,
    );
    const dateCode = String(dateRow.date_code);
    runningLockName = `contractor_user_${dateCode}`;

    const [[lockRow]] = await connection.query(
      `SELECT GET_LOCK(?, 10) AS lock_acquired`,
      [runningLockName],
    );

    if (Number(lockRow.lock_acquired) !== 1) {
      throw new Error("ไม่สามารถสร้างเลขผู้ใช้งานชั่วคราวได้ กรุณาลองใหม่");
    }
    hasRunningLock = true;

    const [[runningRow]] = await connection.query(
      `
        SELECT COALESCE(MAX(CAST(RIGHT(username, 2) AS UNSIGNED)), 0) AS last_no
        FROM um_users
        WHERE username LIKE ?
          AND CHAR_LENGTH(username) = 11
      `,
      [`T${dateCode}%`],
    );
    const nextRunning = Number(runningRow.last_no) + 1;

    if (nextRunning > 99) {
      await connection.rollback();
      return res.status(409).json({
        message: "เลขผู้ใช้งานชั่วคราวของวันนี้ครบ 99 รายการแล้ว",
      });
    }

    const username = `T${dateCode}${String(nextRunning).padStart(2, "0")}`;
    const employeeCode = username;

    const [userResult] = await connection.query(
      `
        INSERT INTO um_users (
          employee_code,
          username,
          password,
          title_name,
          first_name,
          last_name,
          gender,
          citizen_id,
          email,
          tel,
          role_id,
          employment_type,
          warehouse_id,
          is_active,
          license_no,
          license_expire,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONTRACTOR', ?, 1, ?, ?, NOW(), NOW())
      `,
      [
        employeeCode,
        username,
        tel,
        textOrNull(user.title_name),
        firstName,
        lastName,
        textOrNull(user.gender),
        textOrNull(user.citizen_id),
        textOrNull(user.email),
        tel,
        CONTRACTOR_ROLE_ID,
        warehouseId,
        licenseNo,
        licenseExpire,
      ],
    );

    const contractorUserId = userResult.insertId;

    await connection.query(
      `
        INSERT INTO um_user_warehouses (user_id, warehouse_id, is_active)
        VALUES (?, ?, 1)
      `,
      [contractorUserId, warehouseId],
    );

    const [vehicleResult] = await connection.query(
      `
        INSERT INTO mm_vehicles_contractor (
          user_truck_id,
          license_plate,
          license_plate_province_id,
          brand_id,
          model,
          color,
          vehicle_type_id,
          max_load_kg,
          owner_name,
          owner_tel,
          warehouse_id,
          created_by,
          is_deleted,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'N', NOW(), NOW())
      `,
      [
        contractorUserId,
        licensePlate,
        provinceId,
        positiveIdOrNull(vehicle.brand_id),
        textOrNull(vehicle.model),
        textOrNull(vehicle.color),
        positiveIdOrNull(vehicle.vehicle_type_id),
        vehicle.max_load_kg || null,
        textOrNull(vehicle.owner_name) || `${firstName} ${lastName}`,
        textOrNull(vehicle.owner_tel) || textOrNull(user.tel),
        warehouseId,
        createdBy,
      ],
    );

    await connection.commit();

    return res.status(201).json({
      message: "สร้างคนขับและรถเสริมสำเร็จ",
      user_id: contractorUserId,
      vehicle_contractor_id: vehicleResult.insertId,
      username,
      password: tel,
    });
  } catch (error) {
    if (connection) await connection.rollback();

    console.error("createContractor error:", error);
    return res.status(500).json({ message: error.message });
  } finally {
    if (connection && hasRunningLock && runningLockName) {
      try {
        await connection.query(`SELECT RELEASE_LOCK(?)`, [runningLockName]);
      } catch (releaseError) {
        console.error("release contractor running lock error:", releaseError);
      }
    }

    if (connection) connection.release();
  }
};
