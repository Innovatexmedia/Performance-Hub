import { useNavigate } from 'react-router-dom';
import { Crown, ArrowRight } from 'lucide-react';
import { Modal, Button } from './ui';

export function UpgradeRequiredModal({
  open, onClose, message, resource, limit, current,
}: {
  open: boolean;
  onClose: () => void;
  message: string;
  resource?: string;
  limit?: number;
  current?: number;
}) {
  const navigate = useNavigate();

  const goToBilling = () => {
    onClose();
    navigate('/settings?tab=billing');
  };

  return (
    <Modal open={open} onClose={onClose} title="Upgrade Required" size="sm">
      {/* Negative margins cancel out Modal's own px-6 py-5 wrapper so this
          gradient bleeds edge-to-edge instead of sitting in a smaller
          padded box within a padded box. */}
      <div className="-mx-6 -mb-5 -mt-5 overflow-hidden rounded-b-2xl bg-gradient-to-br from-amber-50 via-amber-50/40 to-transparent px-6 pb-6 pt-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-yellow-500 shadow-lg shadow-amber-500/30">
          <Crown size={26} className="text-white" fill="white" />
        </div>
        <h2 className="mt-4 text-lg font-bold text-ink-900">You've hit your plan's limit</h2>

        {resource && limit !== undefined && current !== undefined && (
          <div className="mx-auto mt-4 flex max-w-[220px] items-center justify-between rounded-lg border border-amber-200 bg-white/70 px-4 py-2.5">
            <span className="text-xs font-medium capitalize text-ink-500">{resource}</span>
            <span className="text-sm font-bold text-amber-700">{current} / {limit}</span>
          </div>
        )}

        <p className="mx-auto mt-4 max-w-xs text-sm text-ink-600">{message}</p>

        <div className="mt-6 flex flex-col gap-2">
          <Button
            onClick={goToBilling}
            className="w-full justify-center gap-1.5 bg-gradient-to-br from-amber-500 to-yellow-600 hover:opacity-90"
          >
            Upgrade Plan <ArrowRight size={15} />
          </Button>
          <button onClick={onClose} className="py-1.5 text-xs font-medium text-ink-400 hover:text-ink-600">
            Maybe later
          </button>
        </div>
      </div>
    </Modal>
  );
}