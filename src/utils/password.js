import bcrypt from 'bcryptjs';

const COST = 12;
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', COST);

export const hashPassword = (password) => bcrypt.hash(password, COST);

// Když uživatel neexistuje, porovnáváme proti falešnému hashi, aby se
// odpověď nezrychlila a nešlo zjišťovat, které účty existují.
export async function verifyPassword(password, hash) {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}