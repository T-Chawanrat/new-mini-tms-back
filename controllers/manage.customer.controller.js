import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";

/* ================= CUSTOMER ================= */

export const getCustomers = async (req, res) => {
  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { search } = req.query;

    let sql = `
      SELECT *
      FROM mm_customers
      WHERE 1=1
    `;

    if (search) {
      sql += `
        AND (
          ${buildLike("name", search)}
          OR ${buildLike("code", search)}
        )
      `;
    }

    sql += ` ORDER BY id ASC`;

    const [rows] = await db.query(sql);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const createCustomer = async (req, res) => {
  try {
    // 🔥 รองรับ token
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { code, name, tax_id, address, subdistrict_id, district_id, province_id, zip_code, tel, line, contact_name, contact_tel, email, type } =
      req.body;

      if (!code || !name) {
        return res.status(400).json({
          message: "code / name required",
        });
      }

    const customerType = type || "BUSINESS";

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

    const customerType = type || "BUSINESS";

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

// export const deleteCustomerHard = async (req, res) => {
//   let connection;

//   try {
//     // 🔥 รองรับ token
//     if (!req.user) {
//       return res.status(401).json({ message: "unauthorized" });
//     }

//     const { id } = req.params;

//     connection = await db.getConnection();
//     await connection.beginTransaction();

//     await connection.query(`DELETE FROM um_users WHERE customer_id = ?`, [id]);

//     const [result] = await connection.query(`DELETE FROM mm_customers WHERE id = ?`, [id]);

//     if (result.affectedRows === 0) {
//       await connection.rollback();
//       connection.release();

//       return res.status(404).json({
//         message: "customer not found",
//       });
//     }

//     await connection.commit();
//     connection.release();

//     res.json({ message: "hard delete success" });
//   } catch (err) {
//     if (connection) await connection.rollback();
//     if (connection) connection.release();

//     res.status(500).json({ message: err.message });
//   }
// };

export const createCustomerUser = async (req, res) => {
  let connection;

  try {
    if (!req.user) {
      return res.status(401).json({ message: "unauthorized" });
    }

    const { username, first_name, last_name, customer_id } = req.body;

    if (!username || !customer_id) {
      return res.status(400).json({
        message: "username / customer required",
      });
    }

    const defaultPassword = "123456";

    connection = await db.getConnection();
    await connection.beginTransaction();

    const [exists] = await connection.query(
      `SELECT id FROM um_users WHERE username = ? LIMIT 1`,
      [username],
    );

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
      [
        username,
        defaultPassword,
        first_name || null,
        last_name || null,
        CUSTOMER_ROLE,
        customer_id,
      ],
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
