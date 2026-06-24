export function Input({
  label,
  error,
  className = "",
  ...props
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-text-primary">{label}</label>
      )}
      <input
        className={`px-3 py-2 rounded bg-bg-overlay border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-accent ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-status-red">{error}</span>}
    </div>
  );
}

export function Textarea({
  label,
  error,
  className = "",
  ...props
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-text-primary">{label}</label>
      )}
      <textarea
        className={`px-3 py-2 rounded bg-bg-overlay border border-border text-text-primary placeholder-text-muted focus:outline-none focus:border-accent resize-none ${className}`}
        {...props}
      />
      {error && <span className="text-xs text-status-red">{error}</span>}
    </div>
  );
}

export function Select({
  label,
  options,
  error,
  className = "",
  ...props
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label className="text-sm font-medium text-text-primary">{label}</label>
      )}
      <select
        className={`px-3 py-2 rounded bg-bg-overlay border border-border text-text-primary focus:outline-none focus:border-accent cursor-pointer ${className}`}
        {...props}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-status-red">{error}</span>}
    </div>
  );
}
