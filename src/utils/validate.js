// Všechny vstupy musí být řetězce, jinak by šlo poslat {"$ne": ""} (NoSQL injection).
export const isStudentNumber = (v) => typeof v === 'string' && /^\d{6}$/.test(v);

// bcrypt zpracuje max. 72 bajtů
export const isValidPassword = (v) =>
  typeof v === 'string' && v.length >= 8 && Buffer.byteLength(v) <= 72;

export const isName = (v) => typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100;

export const isCredits = (v) => Number.isInteger(v) && v >= 0 && v <= 100000;