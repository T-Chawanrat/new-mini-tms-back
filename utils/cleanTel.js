export const cleanTel = (tel) => {
  if (!tel) return "";

  return tel
    .toString()
    .replace(/[^0-9]/g, "")
    .replace(/^66/, "0");
};