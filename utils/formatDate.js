// src/utils/formatDate.js

const pad2 = (value) => String(value).padStart(2, "0");

const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

const isExcelSerial = (value) => {
  // Excel serial ส่วนใหญ่จะเป็นเลขประมาณ 30000+
  // เช่น 46116 ไม่ควรใช้ !isNaN เฉย ๆ เพราะ string แปลก ๆ อาจหลุดเข้าเงื่อนไข
  if (typeof value === "number") return value > 30000;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) && Number(trimmed) > 30000;
  }

  return false;
};

const fromExcelSerial = (value) => {
  const serial = Number(value);

  // Excel serial date -> JS Date
  // ใช้ UTC ก่อน แล้วค่อยดึง local ด้วย getFullYear/getMonth/getDate
  return new Date((serial - 25569) * 86400 * 1000);
};

const formatLocalDateParts = (date) => {
  if (!isValidDate(date)) return null;

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  return `${year}-${month}-${day}`;
};

const formatLocalDateTimeParts = (date) => {
  if (!isValidDate(date)) return null;

  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());

  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
};

export const formatDateOnly = (date) => {
  if (!date) return null;

  // ✅ Excel serial เช่น 46116
  if (isExcelSerial(date)) {
    const d = fromExcelSerial(date);
    return formatLocalDateParts(d);
  }

  // ✅ already YYYY-MM-DD
  if (typeof date === "string") {
    const trimmed = date.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // ✅ dd/mm/yyyy หรือ d/m/yyyy
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split("/");
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    // ✅ yyyy-mm-ddTHH:mm:ss.sssZ
    // เช่น 2026-09-07T17:00:00.000Z
    // แปลงด้วย Date แล้วดึง local date เพื่อแก้ timezone ไทย
    const parsed = new Date(trimmed);
    return formatLocalDateParts(parsed);
  }

  // ✅ Date object จาก mysql2
  if (date instanceof Date) {
    return formatLocalDateParts(date);
  }

  // fallback
  const d = new Date(date);
  return formatLocalDateParts(d);
};

export const formatDateTime = (date) => {
  if (!date) return null;

  // ✅ Excel serial
  if (isExcelSerial(date)) {
    const d = fromExcelSerial(date);
    return formatLocalDateTimeParts(d);
  }

  if (typeof date === "string") {
    const trimmed = date.trim();

    // ✅ already YYYY-MM-DD HH:mm:ss
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    // ✅ already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed} 00:00:00`;
    }

    // ✅ dd/mm/yyyy
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split("/");
      return `${y}-${pad2(m)}-${pad2(d)} 00:00:00`;
    }

    const parsed = new Date(trimmed);
    return formatLocalDateTimeParts(parsed);
  }

  if (date instanceof Date) {
    return formatLocalDateTimeParts(date);
  }

  const d = new Date(date);
  return formatLocalDateTimeParts(d);
};

export const addDaysDateOnly = (days = 0, baseDate = new Date()) => {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + Number(days || 0));

  return formatDateOnly(date);
};