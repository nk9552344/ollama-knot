import { Button } from "./Button";

export function ConfirmInline({ onConfirm, onCancel, message }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-status-red/30 bg-status-red/10 px-2 py-1.5">
      <span className="text-xs text-text-primary truncate">{message}</span>
      <div className="flex shrink-0 gap-1">
        <Button variant="danger" size="sm" onClick={onConfirm}>
          Yes
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
