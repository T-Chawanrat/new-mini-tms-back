import db from "../config/db.js";

export const getHolidays = async (req, res) => {
  try {
    const { year, month, active } = req.query;

    const params = [];
    let sql = `
      SELECT
        id,
        holiday_date,
        holiday_name,
        remark,
        is_deleted,
        is_actived,
        created_at,
        updated_at
      FROM mm_holidays
      WHERE is_deleted = 'N'
    `;

    if (active) {
      sql += ` AND is_actived = ?`;
      params.push(active);
    }

    if (year) {
      sql += ` AND YEAR(holiday_date) = ?`;
      params.push(year);
    }

    if (month) {
      sql += ` AND MONTH(holiday_date) = ?`;
      params.push(month);
    }

    sql += ` ORDER BY holiday_date ASC`;

    const [rows] = await db.query(sql, params);

    return res.json({
      success: true,
      data: rows,
    });
  } catch (error) {
    console.error("getHolidays error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูลวันหยุดได้",
    });
  }
};

export const getHolidayById = async (req, res) => {
  try {
    const { id } = req.params;

    const [rows] = await db.query(
      `
      SELECT
        id,
        holiday_date,
        holiday_name,
        remark,
        is_deleted,
        is_actived,
        created_at,
        updated_at
      FROM mm_holidays
      WHERE id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลวันหยุด",
      });
    }

    return res.json({
      success: true,
      data: rows[0],
    });
  } catch (error) {
    console.error("getHolidayById error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถดึงข้อมูลวันหยุดได้",
    });
  }
};

export const createHoliday = async (req, res) => {
  try {
    const {
      holiday_date,
      holiday_name,
      remark = null,
      is_actived = "Y",
    } = req.body;

    if (!holiday_date || !holiday_name) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุวันที่และชื่อวันหยุด",
      });
    }

    const [duplicateRows] = await db.query(
      `
      SELECT id
      FROM mm_holidays
      WHERE holiday_date = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [holiday_date]
    );

    if (duplicateRows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "มีวันหยุดในวันที่นี้อยู่แล้ว",
      });
    }

    const [result] = await db.query(
      `
      INSERT INTO mm_holidays (
        holiday_date,
        holiday_name,
        remark,
        is_deleted,
        is_actived,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, 'N', ?, NOW(), NOW())
      `,
      [holiday_date, holiday_name, remark, is_actived]
    );

    return res.status(201).json({
      success: true,
      message: "เพิ่มวันหยุดสำเร็จ",
      data: {
        id: result.insertId,
        holiday_date,
        holiday_name,
        remark,
        is_deleted: "N",
        is_actived,
      },
    });
  } catch (error) {
    console.error("createHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถเพิ่มวันหยุดได้",
    });
  }
};

export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const {
      holiday_date,
      holiday_name,
      remark = null,
      is_actived = "Y",
    } = req.body;

    if (!holiday_date || !holiday_name) {
      return res.status(400).json({
        success: false,
        message: "กรุณาระบุวันที่และชื่อวันหยุด",
      });
    }

    const [existingRows] = await db.query(
      `
      SELECT id
      FROM mm_holidays
      WHERE id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลวันหยุด",
      });
    }

    const [duplicateRows] = await db.query(
      `
      SELECT id
      FROM mm_holidays
      WHERE holiday_date = ?
        AND id <> ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [holiday_date, id]
    );

    if (duplicateRows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "มีวันหยุดในวันที่นี้อยู่แล้ว",
      });
    }

    await db.query(
      `
      UPDATE mm_holidays
      SET
        holiday_date = ?,
        holiday_name = ?,
        remark = ?,
        is_actived = ?,
        updated_at = NOW()
      WHERE id = ?
        AND is_deleted = 'N'
      `,
      [holiday_date, holiday_name, remark, is_actived, id]
    );

    return res.json({
      success: true,
      message: "แก้ไขวันหยุดสำเร็จ",
    });
  } catch (error) {
    console.error("updateHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถแก้ไขวันหยุดได้",
    });
  }
};

export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;

    const [existingRows] = await db.query(
      `
      SELECT id
      FROM mm_holidays
      WHERE id = ?
        AND is_deleted = 'N'
      LIMIT 1
      `,
      [id]
    );

    if (existingRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "ไม่พบข้อมูลวันหยุด",
      });
    }

    await db.query(
      `
      UPDATE mm_holidays
      SET
        is_deleted = 'Y',
        is_actived = 'N',
        updated_at = NOW()
      WHERE id = ?
      `,
      [id]
    );

    return res.json({
      success: true,
      message: "ลบวันหยุดสำเร็จ",
    });
  } catch (error) {
    console.error("deleteHoliday error:", error);
    return res.status(500).json({
      success: false,
      message: "ไม่สามารถลบวันหยุดได้",
    });
  }
};