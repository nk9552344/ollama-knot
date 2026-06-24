export function Toggle({ checked, onChange, label }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-accent" : "bg-bg-active"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-bg transition-transform ${
            checked ? "translate-x-6" : "translate-x-1"
          }`}
        />
      </button>
      {label && <span className="text-sm text-text-primary">{label}</span>}
    </div>
  );
}
