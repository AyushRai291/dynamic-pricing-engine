import { FormEvent, useEffect, useState } from 'react';
import { CheckCircle2, ExternalLink, Loader2, X } from 'lucide-react';

import { Product, TriggerScrapeResponse } from '../api/client';

type ScrapeDialogProps = {
  product: Product | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    productId: string;
    competitorName: string;
    competitorUrl: string;
  }) => Promise<TriggerScrapeResponse>;
  onEnqueued: (response: TriggerScrapeResponse, product: Product) => void;
};

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ScrapeDialog({
  product,
  isOpen,
  onClose,
  onSubmit,
  onEnqueued,
}: ScrapeDialogProps) {
  const [competitorName, setCompetitorName] = useState('');
  const [competitorUrl, setCompetitorUrl] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [queuedJobId, setQueuedJobId] = useState('');

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSubmitting, onClose]);

  useEffect(() => {
    if (isOpen) {
      setCompetitorName('');
      setCompetitorUrl('');
      setError('');
      setIsSubmitting(false);
      setQueuedJobId('');
    }
  }, [isOpen, product?.id]);

  if (!isOpen || !product) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setQueuedJobId('');

    const trimmedName = competitorName.trim();
    const trimmedUrl = competitorUrl.trim();

    if (!trimmedName) {
      setError('Competitor name is required.');
      return;
    }

    if (!trimmedUrl) {
      setError('Competitor URL is required.');
      return;
    }

    if (!isValidHttpUrl(trimmedUrl)) {
      setError('Competitor URL must begin with http:// or https://.');
      return;
    }

    if (!product) {
      setError('Select a product before enqueueing a scrape job.');
      return;
    }

    const activeProduct = product;

    setIsSubmitting(true);

    try {
      const result = await onSubmit({
        productId: activeProduct.id,
        competitorName: trimmedName,
        competitorUrl: trimmedUrl,
      });
      setQueuedJobId(result.job.id);
      onEnqueued(result, activeProduct);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to enqueue scrape job.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="scrape-dialog-title">
      <button
        className="absolute inset-0 h-full w-full bg-slate-950/50"
        type="button"
        aria-label="Close scrape dialog overlay"
        onClick={isSubmitting ? undefined : onClose}
      />
      <div className="relative w-full max-w-xl rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">Manual scrape</p>
            <h2 id="scrape-dialog-title" className="mt-1 text-lg font-bold text-slate-950">
              Scrape competitor
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {product.name} · SKU {product.sku}
            </p>
          </div>
          <button
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            aria-label="Close scrape dialog"
            onClick={onClose}
            disabled={isSubmitting}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form className="space-y-4 px-5 py-5" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="competitor-name">
              Competitor name
            </label>
            <input
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 px-3 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              id="competitor-name"
              type="text"
              value={competitorName}
              onChange={(event) => setCompetitorName(event.target.value)}
              placeholder="Enter competitor name"
              disabled={isSubmitting}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700" htmlFor="competitor-url">
              Competitor URL
            </label>
            <div className="relative mt-2">
              <input
                className="h-11 w-full rounded-xl border border-slate-200 px-3 pr-10 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                id="competitor-url"
                type="url"
                value={competitorUrl}
                onChange={(event) => setCompetitorUrl(event.target.value)}
                placeholder="https://"
                disabled={isSubmitting}
                required
              />
              <ExternalLink className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            </div>
          </div>

          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
              {error}
            </div>
          ) : null}

          {queuedJobId ? (
            <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Job queued. Job ID: <span className="font-semibold">{queuedJobId}</span>
              </span>
            </div>
          ) : null}

          <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-end">
            <button
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {queuedJobId ? 'Done' : 'Cancel'}
            </button>
            <button
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
              type="submit"
              disabled={isSubmitting || Boolean(queuedJobId)}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {isSubmitting ? 'Enqueueing' : 'Enqueue scrape'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
