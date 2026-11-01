import bcrypt from "bcrypt";

export const hashPassword = (password) => bcrypt.hash(password, 10);

export const verifyPassword = async (password, storedPassword) => {
  if (typeof password !== "string" || typeof storedPassword !== "string") return false;
  if (/^\$2[abxy]\$/.test(storedPassword)) return bcrypt.compare(password, storedPassword);
  // Temporary compatibility for existing plaintext accounts until migration.
  return password === storedPassword;
};
