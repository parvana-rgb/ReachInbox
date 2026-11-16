import { useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { AlertCircle, CheckCircle2, FileUp, Plus, X } from 'lucide-react';
import { api, errorMessage } from '../services/api';
import { PageHeader, Spinner } from '../components/ui';
import { formatDateTime, toLocalInput } from '../utils/format';
import type { ParsedRecipients } from '../types';

const schema = z.object({
  subject: z.string().trim().min(1, 'Enter a subject').max(200, 'Keep the subject under 200 characters'),
  body: z.string().trim().min(1, 'Write your message').max(100000),
  startAt: z.string().min(1, 'Pick a start time').refine((v) => !Number.isNaN(new Date(v).getTime()), 'Pick a valid date and time')
    .refine((v) => new Date(v).getTime() >= Date.now() - 5 * 60_000, 'Start time cannot be in the past'),
  delaySeconds: z.number({ message: 'Enter a number' }).int('Use whole seconds').min(0, 'Cannot be negative').max(86400, 'Max 86,400 seconds'),
  hourlyLimit: z.number({ message: 'Enter a number' }).int('Use a whole number').min(1, 'At least 1').max(100000),
});
type FormValues = z.infer<typeof schema>;
const emailCheck = z.string().email();

export default function ComposePage() {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [report, setReport] = useState<ParsedRecipients | null>(null);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { subject: '', body: '', startAt: toLocalInput(new Date(Date.now() + 2 * 60_000)), delaySeconds: 5, hourlyLimit: 50 },
  });
  const v = watch();

  const merge = (list: string[]) => setRecipients((prev) => [...new Set([...prev, ...list])]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    if (!/\.(csv|txt)$/i.test(file.name)) { toast.error('Only .csv and .txt files are supported'); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error('File is larger than 2 MB'); return; }
    setParsing(true);
    try {
      const r = await api.parseRecipients(file);
      setReport(r);
      merge(r.valid);
      if (r.valid.length) toast.success(`Found ${r.valid.length.toLocaleString()} valid recipient${r.valid.length === 1 ? '' : 's'}`);
      else toast.error('No valid email addresses found in this file');
    } catch (e) { toast.error(errorMessage(e)); } finally { setParsing(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDragging(false); void handleFile(e.dataTransfer.files[0]); };

  function addManual() {
    const val = manual.trim().toLowerCase();
    if (!val) return;
    if (!emailCheck.safeParse(val).success) { setManualError('That is not a valid email address'); return; }
    setManualError(null); merge([val]); setManual('');
  }

  const timeline = useMemo(() => {
    if (!recipients.length || !v.startAt) return null;
    const start = new Date(v.startAt);
    if (Number.isNaN(start.getTime())) return null;
    const delay = Number.isFinite(v.delaySeconds) ? v.delaySeconds : 0;
    return { first: start, last: new Date(start.getTime() + (recipients.length - 1) * delay * 1000) };
  }, [recipients.length, v.startAt, v.delaySeconds]);

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    if (!recipients.length) { setSubmitError('Add at least one recipient by uploading a file.'); return; }
    try {
      const r = await api.schedule({ subject: values.subject, body: values.body, recipients, startAt: new Date(values.startAt).toISOString(), delaySeconds: values.delaySeconds, hourlyLimit: values.hourlyLimit });
      toast.success(`Scheduled ${r.total.toLocaleString()} email${r.total === 1 ? '' : 's'}`);
      navigate('/scheduled');
    } catch (e) { setSubmitError(errorMessage(e)); toast.error('Could not schedule emails'); }
  }

  const Err = ({ m }: { m?: string }) => (m ? <p className="mt-1 text-xs text-stamp" role="alert">{m}</p> : null);

  return (
    <>
      <PageHeader title="Compose new email" subtitle="Write one message, add your leads, and choose when and how fast it goes out." />
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="card space-y-4 p-5">
            <div>
              <label htmlFor="subject" className="label">Subject</label>
              <input id="subject" className="input" placeholder="Quick question about {{company}}" {...register('subject')} />
              <Err m={errors.subject?.message} />
            </div>
            <div>
              <label htmlFor="body" className="label">Message</label>
              <textarea id="body" rows={9} className="input resize-y font-sans leading-relaxed" placeholder="Hi there,&#10;&#10;I wanted to reach out about…" {...register('body')} />
              <div className="flex justify-between"><Err m={errors.body?.message} /><span className="ml-auto mt-1 text-xs text-ink-500">{v.body?.length ?? 0} characters</span></div>
            </div>
          </section>

          <section className="card p-5">
            <h2 className="text-lg font-semibold">Recipients</h2>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop}
              className={`mt-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors ${dragging ? 'border-signal bg-signal-50' : 'border-ink-100 bg-paper-50'}`}>
              {parsing ? <p className="flex items-center justify-center gap-2 text-sm text-ink-500"><Spinner />Reading file…</p> : (
                <>
                  <FileUp className="mx-auto text-ink-300" size={28} />
                  <p className="mt-2 text-sm"><span className="font-medium">Drop a CSV or TXT file here</span>, or</p>
                  <button type="button" className="btn-secondary mt-2" onClick={() => fileInput.current?.click()}>Choose file</button>
                  <p className="mt-2 text-xs text-ink-500">CSV with an “email” column, or one address per line. Max 2 MB.</p>
                </>
              )}
              <input ref={fileInput} type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" aria-label="Upload recipients file" onChange={(e) => void handleFile(e.target.files?.[0])} />
            </div>

            <div className="mt-4 flex gap-2">
              <input className="input" type="email" placeholder="Or add one address" value={manual} aria-label="Add a recipient manually"
                onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }} />
              <button type="button" className="btn-secondary" onClick={addManual}><Plus size={16} />Add</button>
            </div>
            <Err m={manualError ?? undefined} />

            {report && (
              <div className="mt-4 rounded-lg bg-paper-50 p-3 text-sm">
                <p className="flex items-center gap-2 font-medium"><CheckCircle2 size={16} className="text-sent" />{report.fileName}: {report.valid.length.toLocaleString()} valid{report.duplicates ? `, ${report.duplicates} duplicate${report.duplicates === 1 ? '' : 's'} removed` : ''}</p>
                {report.invalid.length > 0 && (
                  <div className="mt-2 text-stamp">
                    <p className="flex items-center gap-2 font-medium"><AlertCircle size={16} />{report.invalid.length} invalid entr{report.invalid.length === 1 ? 'y' : 'ies'} skipped</p>
                    <ul className="mt-1 max-h-28 overflow-auto text-xs">{report.invalid.slice(0, 50).map((i, idx) => <li key={idx}>Line {i.line}: “{i.value}”</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {recipients.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className="font-medium">{recipients.length.toLocaleString()} recipient{recipients.length === 1 ? '' : 's'}</span>
                  <button type="button" className="text-xs text-ink-500 hover:text-stamp" onClick={() => { setRecipients([]); setReport(null); }}>Clear all</button>
                </div>
                <ul className="max-h-44 divide-y divide-ink-100 overflow-auto rounded-lg border border-ink-100 text-sm">
                  {recipients.slice(0, 100).map((r) => (
                    <li key={r} className="flex items-center justify-between px-3 py-1.5"><span className="truncate">{r}</span>
                      <button type="button" aria-label={`Remove ${r}`} className="text-ink-300 hover:text-stamp" onClick={() => setRecipients((p) => p.filter((x) => x !== r))}><X size={14} /></button></li>
                  ))}
                </ul>
                {recipients.length > 100 && <p className="mt-1 text-xs text-ink-500">Showing the first 100 of {recipients.length.toLocaleString()}.</p>}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-24 lg:self-start">
          <section className="card space-y-4 p-5">
            <h2 className="text-lg font-semibold">Schedule</h2>
            <div>
              <label htmlFor="startAt" className="label">Start date and time</label>
              <input id="startAt" type="datetime-local" className="input" {...register('startAt')} />
              <Err m={errors.startAt?.message} />
            </div>
            <div>
              <label htmlFor="delay" className="label">Delay between emails (seconds)</label>
              <input id="delay" type="number" min={0} className="input" {...register('delaySeconds', { valueAsNumber: true })} />
              <Err m={errors.delaySeconds?.message} />
            </div>
            <div>
              <label htmlFor="limit" className="label">Hourly limit per sender</label>
              <input id="limit" type="number" min={1} className="input" {...register('hourlyLimit', { valueAsNumber: true })} />
              <Err m={errors.hourlyLimit?.message} />
              <p className="mt-1 text-xs text-ink-500">Extra emails wait for the next hour. None are dropped.</p>
            </div>
          </section>

          <section className="card p-5 text-sm">
            <h2 className="text-lg font-semibold">Summary</h2>
            <dl className="mt-3 space-y-2">
              <div className="flex justify-between"><dt className="text-ink-500">Recipients</dt><dd className="font-medium tabular-nums">{recipients.length.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">First email</dt><dd className="font-medium">{timeline ? formatDateTime(timeline.first.toISOString()) : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-500">Last email</dt><dd className="font-medium">{timeline ? formatDateTime(timeline.last.toISOString()) : '—'}</dd></div>
            </dl>
            {submitError && <p role="alert" className="mt-3 rounded-lg bg-stamp-50 p-2.5 text-xs text-stamp">{submitError}</p>}
            <button type="submit" className="btn-primary mt-4 w-full" disabled={isSubmitting || parsing}>
              {isSubmitting && <Spinner />}{isSubmitting ? 'Scheduling…' : `Schedule ${recipients.length ? recipients.length.toLocaleString() + ' ' : ''}email${recipients.length === 1 ? '' : 's'}`}
            </button>
          </section>
        </aside>
      </form>
    </>
  );
}
