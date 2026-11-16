import type { Request, Response } from 'express';
import { listQuerySchema, scheduleSchema } from '../validators/email.validators';
import { scheduleEmails, serializeEmail } from '../services/email.service';
import { findEmailForUser, listEmails } from '../repositories/email.repository';
import { reindexDirty, searchEmails } from '../services/search.service';
import { parseRecipients } from '../services/recipientParser';
import { badRequest, notFound } from '../utils/errors';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function schedule(req: Request, res: Response) {
  const input = scheduleSchema.parse(req.body);
  res.status(201).json(await scheduleEmails(req.user!.id, input));
}

export async function listScheduled(req: Request, res: Response) {
  const q = listQuerySchema.parse(req.query);
  const statuses = q.status === 'scheduled' || q.status === 'processing' ? [q.status] : (['scheduled', 'processing'] as const);
  const r = await listEmails({ userId: req.user!.id, statuses: [...statuses], q: q.q, page: q.page, pageSize: q.pageSize, order: 'sendAtAsc' });
  res.json({ ...r, items: r.items.map(serializeEmail) });
}

export async function listSent(req: Request, res: Response) {
  const q = listQuerySchema.parse(req.query);
  const statuses = q.status === 'sent' || q.status === 'failed' ? [q.status] : (['sent', 'failed'] as const);
  const r = await listEmails({ userId: req.user!.id, statuses: [...statuses], q: q.q, page: q.page, pageSize: q.pageSize, order: 'recentActivity' });
  res.json({ ...r, items: r.items.map(serializeEmail) });
}

export async function getOne(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!uuid.test(id)) throw badRequest('Invalid email id');
  const e = await findEmailForUser(req.user!.id, id); // scoped by owner: other users' ids look like 404
  if (!e) throw notFound('Email not found');
  res.json({ ...serializeEmail(e), body: e.batch.body, hourlyLimit: e.batch.hourlyLimit, delaySeconds: e.batch.delaySeconds, smtpResponse: e.smtpResponse });
}

export async function search(req: Request, res: Response) {
  const q = listQuerySchema.parse(req.query);
  const r = await searchEmails({ userId: req.user!.id, q: q.q, status: q.status, page: q.page, pageSize: q.pageSize });
  res.json({ ...r, items: r.items.map(serializeEmail) });
}

export async function parseFile(req: Request, res: Response) {
  if (!req.file) throw badRequest('Attach a .csv or .txt file in the "file" field');
  const name = req.file.originalname.toLowerCase();
  if (!/\.(csv|txt)$/.test(name)) throw badRequest('Only .csv and .txt files are supported');
  res.json({ fileName: req.file.originalname, ...parseRecipients(req.file.buffer.toString('utf8')) });
}

export async function reindex(req: Request, res: Response) {
  res.json({ attempted: await reindexDirty(req.user!.id) });
}
