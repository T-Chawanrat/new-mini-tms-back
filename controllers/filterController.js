// import db from "../config/db.js";

// export const getCustomers = async (req, res) => {
//   try {
//     const sql = `
//       SELECT *
//       FROM mini_tms_dev.um_customers 
//       ORDER BY customer_name ASC
//     `;
//     const [rows] = await db.query(sql);

//     res.json({
//       data: rows,
//       count: rows.length,
//     });
//   } catch (err) {
//     console.error("getCustomers error:", err);
//     res.status(500).json({ message: "An error occurred" });
//   }
// };

// export const getDropdownWarehouse = async (req, res) => {
//   try {
//     const sql = `
//       SELECT *
//       FROM mini_tms_dev.mm_warehouses
//       `;
//     const [rows] = await db.query(sql);

//     res.json({
//       data: rows,
//       count: rows.length,
//     });
//   } catch (err) {
//     console.error("getDropdownWarehouse error:", err);
//     res.status(500).json({ message: "An error occurred" });
//   }
// };

// export const getWarehouses = async (req, res) => {
//   try {
//     const { zip_code } = req.query; 

//     let sql = `
//       SELECT *
//       FROM mini_tms_dev.master_warehouses
//     `;
//     const params = [];

//     if (zip_code) {
//       sql += ` WHERE zip_code = ?`;
//       params.push(zip_code);
//     }

//     const [rows] = await db.query(sql, params);

//     res.json({
//       data: rows,
//       count: rows.length,
//     });
//   } catch (err) {
//     console.error("getWarehouses error:", err);
//     res.status(500).json({ message: "An error occurred" });
//   }
// };

// export const searchAddress = async (req, res) => {
//   try {
//     const { keyword } = req.query;

//     if (!keyword || String(keyword).trim().length < 2) {
//       return res.json({ data: [], count: 0 });
//     }

//     const kw = `%${keyword.trim()}%`;

//     const sql = `
//       SELECT
//         id,
//         tambon_id,
//         tambon_name_th,
//         ampur_id,
//         ampur_name_th,
//         province_id,
//         province_name_th,
//         zip_code,
//         warehouse_id,
//         warehouse_code,
//         warehouse_name
//       FROM mini_tms_dev.master_warehouses
//       WHERE
//         tambon_name_th LIKE ?
//         OR ampur_name_th LIKE ?
//         OR province_name_th LIKE ?
//         OR zip_code LIKE ?
//       LIMIT 50
//     `;

//     const params = [kw, kw, kw, kw];

//     const [rows] = await db.query(sql, params);

//     res.json({
//       data: rows,
//       count: rows.length,
//     });
//   } catch (err) {
//     console.error("searchAddress error:", err);
//     res.status(500).json({ message: "An error occurred" });
//   }
// };
