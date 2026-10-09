// Helper ภายใน
const pad2 = (value) => String(value).padStart(2, "0");

const isValidDate = (date) => date instanceof Date && !Number.isNaN(date.getTime());

// วันที่จาก Excel
const isExcelSerial = (value) => {
  if (typeof value === "number") return value > 30000;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d+$/.test(trimmed) && Number(trimmed) > 30000;
  }

  return false;
};

const fromExcelSerial = (value) => {
  const serial = Number(value);
  return new Date((serial - 25569) * 86400 * 1000);
};

// สร้างรูปแบบวันที่ภายใน
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

// รับวันที่แล้วแปลงเป็น YYYY-MM-DD
export const formatDateOnly = (date) => {
  if (!date) return null;

  if (isExcelSerial(date)) {
    return formatLocalDateParts(fromExcelSerial(date));
  }

  if (typeof date === "string") {
    const trimmed = date.trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split("/");
      return `${y}-${pad2(m)}-${pad2(d)}`;
    }

    return formatLocalDateParts(new Date(trimmed));
  }

  if (date instanceof Date) {
    return formatLocalDateParts(date);
  }

  return formatLocalDateParts(new Date(date));
};

// รับวันเวลาแล้วแปลงเป็น YYYY-MM-DD HH:mm:ss
export const formatDateTime = (date) => {
  if (!date) return null;

  if (isExcelSerial(date)) {
    return formatLocalDateTimeParts(fromExcelSerial(date));
  }

  if (typeof date === "string") {
    const trimmed = date.trim();

    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
      return trimmed;
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed} 00:00:00`;
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
      const [d, m, y] = trimmed.split("/");
      return `${y}-${pad2(m)}-${pad2(d)} 00:00:00`;
    }

    return formatLocalDateTimeParts(new Date(trimmed));
  }

  if (date instanceof Date) {
    return formatLocalDateTimeParts(date);
  }

  return formatLocalDateTimeParts(new Date(date));
};

// คำนวณวันที่
export const addDaysDateOnly = (days = 0, baseDate = new Date()) => {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + Number(days || 0));

  return formatDateOnly(date);
};
