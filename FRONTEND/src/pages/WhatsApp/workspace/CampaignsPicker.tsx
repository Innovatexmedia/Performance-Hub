/**
 * CampaignsPicker — the chooser shown when "Campaigns" is clicked in the
 * WhatsApp workspace nav.
 *
 * WHY A PICKER AT ALL
 * ───────────────────
 * Four things live under Campaigns and they are not the same kind of thing.
 * Two are real sending modes (a dashboard campaign you send yourself; an API
 * campaign your systems trigger). Two are VIEWS over campaigns that already
 * exist — Broadcast is a type filter, Scheduled is a status filter. Landing
 * straight on one list made the API mode invisible and made Scheduled look
 * like a separate engine.
 *
 * The copy below says which is which on purpose: "filtered view" is not
 * decoration, it is the thing people get wrong.
 */

import { Megaphone, Terminal, Radio, Clock } from 'lucide-react';
import { Modal, cn } from '@/components/ui';

export type CampaignKind = 'campaigns' | 'api' | 'broadcast' | 'scheduled';

const OPTIONS: {
  id: CampaignKind;
  label: string;
  description: string;
  icon: React.ReactNode;
  tag?: string;
  /** The icon tile's own colour.
   *
   *  Each option gets one, not just the API entry: a single coloured tile in a
   *  row of grey ones made the other three look disabled. The colours aren't
   *  decoration either -- they say what kind of thing each option is. The two
   *  real sending modes get their own hues, the two filtered views share one,
   *  and API Campaigns carries the dark warm tint of the section it opens, so
   *  the tile previews where it leads.
   *
   *  The cards themselves stay white. Tinting a whole card in a row of four
   *  reads as a rendering fault; a tile is already a distinct element and can
   *  carry the difference without breaking the rhythm. */
  tile: string;
}[] = [
  {
    id: 'campaigns',
    label: 'Campaigns',
    description: 'Send to an audience you build here — filters, tags, contact lists.',
    icon: <Megaphone size={18} />,
    tile: 'bg-brand-50 text-brand-600',
  },
  {
    id: 'api',
    label: 'API Campaigns',
    description: 'Your application triggers the send over HTTP and supplies the recipients each time.',
    icon: <Terminal size={18} />,
    tag: 'For developers',
    tile: 'bg-[#16100d] text-amber-200/90',
  },
  {
    id: 'broadcast',
    label: 'Broadcast',
    description: 'Campaigns of type Broadcast.',
    icon: <Radio size={18} />,
    tag: 'Filtered view',
    tile: 'bg-teal-50 text-teal-600',
  },
  {
    id: 'scheduled',
    label: 'Scheduled',
    description: 'Campaigns with a send time set. Not a separate way of sending — the same campaigns, waiting.',
    icon: <Clock size={18} />,
    tag: 'Filtered view',
    tile: 'bg-teal-50 text-teal-600',
  },
];

export function CampaignsPicker({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (kind: CampaignKind) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Campaigns">
      <p className="text-sm text-ink-500">What would you like to work on?</p>

      <div className="mt-3 space-y-2">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onSelect(option.id)}
            className={cn(
              'flex w-full items-start gap-3 rounded-xl border border-ink-200 p-3 text-left transition',
              'hover:border-brand-300 hover:bg-brand-50/50 focus:outline-none focus:ring-2 focus:ring-brand-500'
            )}
          >
            <span className={cn('mt-0.5 shrink-0 rounded-lg p-2', option.tile)}>{option.icon}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-medium text-ink-900">{option.label}</span>
                {option.tag && (
                  <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                    {option.tag}
                  </span>
                )}
              </span>
              <span className="mt-0.5 block text-sm text-ink-500">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export default CampaignsPicker;