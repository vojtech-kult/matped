import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { FormSubmission } from '../models/FormSubmission.js';
import { sendLeadToDiscord } from '../utils/discord.js';

const router = Router();

const leadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Příliš mnoho odeslání, zkuste to prosím později.' },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+\d\s()-]{6,30}$/;

// Pravidla jednotlivých typů formuláře
const FORMS = {
  poptavka: { name: true, contact: true, message: 'optional', rating: false },
  dotaz: { name: false, contact: true, message: 'required', rating: false },
  hodnoceni: { name: true, contact: false, message: 'required', rating: true },
};

// Vše, co není řetězec, se změní na prázdný řetězec (ochrana proti NoSQL injection)
const str = (value) => (typeof value === 'string' ? value.trim() : '');
const bad = (res, error) => res.status(400).json({ error });

router.post('/', leadLimiter, async (req, res) => {
  const body = req.body ?? {};

  // Honeypot: skryté pole, které vyplní jen boti. Tváříme se, že je vše v pořádku.
  if (str(body.website)) return res.status(201).json({ ok: true });

  const type = typeof body.type === 'string' ? body.type : '';
  if (!Object.hasOwn(FORMS, type)) return bad(res, 'Neznámý typ formuláře');
  const rule = FORMS[type];

  let name = '';
  if (rule.name) {
    name = str(body.name);
    if (name.length < 2 || name.length > 100) return bad(res, 'Jméno musí mít 2 až 100 znaků');
  }

  let email = '';
  let phone = '';
  if (rule.contact) {
    email = str(body.email).toLowerCase();
    phone = str(body.phone);
    if (!email && !phone) return bad(res, 'Vyplňte e-mail nebo telefon, abychom se vám mohli ozvat');
    if (email && (email.length > 200 || !EMAIL_RE.test(email))) return bad(res, 'Zadejte platný e-mail');
    if (phone && !PHONE_RE.test(phone)) return bad(res, 'Telefon má neplatný formát');
  }

  const message = str(body.message);
  if (message.length > 2000) return bad(res, 'Zpráva může mít nejvýše 2000 znaků');
  if (rule.message === 'required' && message.length < 5) {
    return bad(res, 'Zpráva musí mít alespoň 5 znaků');
  }

  let rating;
  if (rule.rating) {
    rating = body.rating;
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return bad(res, 'Vyberte hodnocení 1 až 5 hvězdiček');
    }
  }

  if (body.consent !== true) return bad(res, 'Je nutný souhlas se zpracováním údajů');

  const lead = await FormSubmission.create({
    type,
    name: name || undefined,
    email: email || undefined,
    phone: phone || undefined,
    message: message || undefined,
    rating,
    consent: true,
  });

  // Návštěvníkovi odpovíme hned, na Discord se nečeká
  res.status(201).json({ ok: true });

  try {
    await sendLeadToDiscord(lead);
    await FormSubmission.updateOne({ _id: lead._id }, { 'discord.notifiedAt': new Date() });
  } catch (err) {
    console.error('Discord notifikace selhala:', err.message);
    await FormSubmission.updateOne({ _id: lead._id }, { 'discord.error': err.message }).catch(() => {});
  }
});

export default router;