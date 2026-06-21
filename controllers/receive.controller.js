import db from "../config/db.js";
import { buildLike } from "../utils/cleanText.js";
import { formatDateOnly ,addDaysDateOnly } from "../utils/formatDate.js";



export const getReceiveCustomers = async (req, res) => {
  try {
    const { search } = req.query;

    let sql = `
      SELECT
        id,
        code,
        name
      FROM mm_customers
      WHERE is_active = '1'
        AND type = 'BUSINESS'
    `;

    if (search) {
      sql += `
        AND (
          ${buildLike("code", search)}
          OR ${buildLike("name", search)}
        )
      `;
    }

    sql += `
      ORDER BY id ASC
    `;

    const [rows] = await db.query(sql);

    return res.json(rows);
  } catch (err) {
    console.error("GET RECEIVE CUSTOMERS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceiveShippers = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    let whereSql = `
      WHERE s.customer_id = ?
        AND s.is_deleted = 'N'
    `;

    const params = [customer_id];

    if (search) {
      whereSql += `
        AND (
          ${buildLike("s.shipper_code", search)}
          OR ${buildLike("s.shipper_name", search)}
        )
      `;
    }

    const dataSql = `
      SELECT
        s.shipper_id,
        s.shipper_code,
        s.shipper_name,
        s.address,

        s.subdistrict_id,
        s.district_id,
        s.province_id,
        s.zip_code,
        s.tel,

        addr.subdistrict_name,
        addr.district_name,
        addr.province_name

      FROM mm_shippers s

      LEFT JOIN mm_master_addresses addr
        ON addr.subdistrict_id = s.subdistrict_id
        AND addr.district_id = s.district_id
        AND addr.province_id = s.province_id

      ${whereSql}

      ORDER BY s.shipper_id ASC
    `;

    const [rows] = await db.query(dataSql, params);

    return res.json({
      data: rows,
      pagination: {
        page: 1,
        limit: rows.length,
        total: rows.length,
        totalPages: 1,
      },
    });
  } catch (err) {
    console.error("GET RECEIVE SHIPPERS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceiveRecipients = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    let whereSql = `
      WHERE r.customer_id = ?
        AND r.is_deleted = 'N'
    `;

    const params = [customer_id];

    if (search) {
      whereSql += `
        AND (
          ${buildLike("r.recipient_code", search)}
          OR ${buildLike("r.recipient_name", search)}
          OR ${buildLike("rd.recipient_detail_name", search)}
          OR ${buildLike("rd.address", search)}
          OR ${buildLike("rd.tel1", search)}
        )
      `;
    }

    const dataSql = `
      SELECT
        r.recipient_id,
        r.recipient_code,
        r.recipient_name,

        rd.recipient_detail_id,
        rd.recipient_detail_name,
        rd.address,
        rd.subdistrict_id,
        rd.district_id,
        rd.province_id,
        rd.zip_code,
        rd.tel1 AS tel,
        rd.is_default,

        a.subdistrict_name,
        a.district_name,
        a.province_name

      FROM mm_recipients r

      LEFT JOIN mm_recipient_details rd
        ON rd.recipient_id = r.recipient_id
        AND rd.is_deleted = 'N'

      LEFT JOIN mm_master_addresses a
        ON a.subdistrict_id = rd.subdistrict_id
        AND a.district_id = rd.district_id
        AND a.province_id = rd.province_id

      ${whereSql}

      ORDER BY
        r.recipient_id DESC,
        CASE WHEN rd.is_default = 'Y' THEN 0 ELSE 1 END,
        rd.recipient_detail_id DESC
    `;

    const [rows] = await db.query(dataSql, params);

    const total = rows.length;

    return res.json({
      data: rows,
      pagination: {
        page: 1,
        limit: total,
        total,
        totalPages: 1,
      },
    });
  } catch (err) {
    console.error("GET RECEIVE RECIPIENTS ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getReceivePackages = async (req, res) => {
  try {
    const { customer_id } = req.params;
    const { search } = req.query;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    const searchText = search ? String(search).trim() : "";

    let packageWhere = `
      p.customer_id = ?
      AND p.is_deleted = 'N'
      AND (
        p.is_actived = 'Y'
        OR p.is_actived = '1'
        OR p.is_actived = 1
      )
      AND p.type = 'BUSINESS'
    `;

    const params = [customer_id];

    if (searchText) {
      packageWhere += `
        AND (
          p.package_name LIKE ?
          OR p.package_code LIKE ?
          OR d.package_detail_name LIKE ?
        )
      `;
      params.push(`%${searchText}%`, `%${searchText}%`, `%${searchText}%`);
    }

    const sql = `
      SELECT
        p.package_id,
        p.package_code,
        p.package_name,
        p.customer_id,
        p.type,

        d.id AS package_detail_id,
        d.package_detail_code,
        d.package_detail_name,
        d.unit_id,
        d.size_min,
        d.size_max,
        d.weight_min,
        d.weight_max,
        d.cost,
        d.cost_difference_warehouse,
        d.cost_go,
        d.cost_return,
        d.is_document_return,
        d.is_weight_fix,
        d.is_vat

      FROM mm_packages p

      LEFT JOIN mm_package_business d
        ON d.package_id = p.package_id
        AND d.is_deleted = 'N'

      WHERE ${packageWhere}

      ORDER BY
        p.package_id ASC,
        d.id ASC
    `;

    const [rows] = await db.query(sql, params);

    return res.json({
      data: rows,
    });
  } catch (err) {
    console.error("GET RECEIVE PACKAGES ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getShipperROCode = async (req, res) => {
  try {
    const { customer_id, shipper_id } = req.params;

    if (!customer_id || !shipper_id) {
      return res.status(400).json({
        message: "customer_id / shipper_id required",
      });
    }

    const [shipperRows] = await db.query(
      `
        SELECT shipper_id
        FROM mm_shippers
        WHERE shipper_id = ?
          AND customer_id = ?
          AND is_deleted = 'N'
        LIMIT 1
      `,
      [shipper_id, customer_id],
    );

    if (shipperRows.length === 0) {
      return res.status(404).json({
        message: "shipper not found",
      });
    }

    const [rows] = await db.query(
      `
        SELECT
          ro_code_id,
          shipper_id,
          ro_code,
          ro_name
        FROM mm_shipper_ro_code
        WHERE shipper_id = ?
          AND is_deleted = 'N'
        ORDER BY ro_code ASC
      `,
      [shipper_id],
    );

    return res.json(rows);
  } catch (err) {
    console.error("GET SHIPPER RO CODE ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};

export const getRecipientCalendar = async (req, res) => {
  try {
    const { customer_id, recipient_detail_id } = req.params;

    if (!customer_id) {
      return res.status(400).json({ message: "customer_id is required" });
    }

    if (!recipient_detail_id) {
      return res.status(400).json({ message: "recipient_detail_id is required" });
    }

    const sql = `
      SELECT
        r.recipient_id,
        r.recipient_code,
        r.recipient_name,

        rd.recipient_detail_id,
        rd.recipient_detail_name,
        rd.subdistrict_id,
        rd.district_id,
        rd.province_id,
        rd.zip_code,

        sd.id AS subdistrict_day_id,
        sd.day,
        sd.day_id,
        sd.transit_days

      FROM mm_recipient_details rd

      INNER JOIN mm_recipients r
        ON r.recipient_id = rd.recipient_id
        AND r.customer_id = ?
        AND r.is_deleted = 'N'

      LEFT JOIN mm_subdistrict_days sd
        ON sd.subdistrict_id = rd.subdistrict_id
        AND sd.is_deleted = 'N'
        AND sd.is_actived = 'Y'
        AND sd.day_id IS NOT NULL
        AND sd.day_id BETWEEN 0 AND 6

      WHERE rd.recipient_detail_id = ?
        AND rd.is_deleted = 'N'

      ORDER BY sd.day_id ASC
    `;

    const [rows] = await db.query(sql, [customer_id, recipient_detail_id]);

    if (rows.length === 0) {
      return res.status(404).json({
        message: "ไม่พบข้อมูลผู้รับ หรือผู้รับนี้ไม่ได้อยู่ใน customer นี้",
      });
    }

    const first = rows[0];

    const serviceDays = rows
      .filter((row) => row.day_id !== null && row.day_id !== undefined)
      .map((row) => ({
        id: row.subdistrict_day_id,
        day: row.day,
        day_id: Number(row.day_id),
      }))
      .filter((row) => Number.isFinite(row.day_id) && row.day_id >= 0 && row.day_id <= 6);

    const serviceDayIds = serviceDays.map((item) => item.day_id);

    const transitDays = first.transit_days === null || first.transit_days === undefined ? null : Number(first.transit_days);

    const today = addDaysDateOnly(0);
    const endDate = addDaysDateOnly(90);

    const [holidayRows] = await db.query(
      `
        SELECT
          holiday_date,
          holiday_name
        FROM mm_holidays
        WHERE is_deleted = 'N'
          AND is_actived = 'Y'
          AND holiday_date BETWEEN ? AND ?
        ORDER BY holiday_date ASC
      `,
      [today, endDate],
    );

    const holidays = holidayRows
      .map((row) => ({
        holiday_date: formatDateOnly(row.holiday_date),
        holiday_name: row.holiday_name,
      }))
      .filter((item) => item.holiday_date);

    const holidayDates = holidays.map((item) => item.holiday_date);

    return res.json({
      recipient_id: first.recipient_id,
      recipient_code: first.recipient_code,
      recipient_name: first.recipient_name,

      recipient_detail_id: first.recipient_detail_id,
      recipient_detail_name: first.recipient_detail_name,

      subdistrict_id: first.subdistrict_id,
      district_id: first.district_id,
      province_id: first.province_id,
      zip_code: first.zip_code,

      transit_days: Number.isFinite(transitDays) ? transitDays : null,

      service_days: serviceDays,
      service_day_ids: serviceDayIds,

      holidays,
      holiday_dates: holidayDates,
    });
  } catch (err) {
    console.error("GET RECIPIENT CALENDAR ERROR:", err);
    return res.status(500).json({ message: err.message });
  }
};
