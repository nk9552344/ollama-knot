const STATUS_STYLES = {
  online: {
    dot: "bg-status-green",
    ring: "ring-status-green/30",
    label: "Online",
    pulse: true,
  },
  offline: {
    dot: "bg-status-red",
    ring: "ring-status-red/30",
    label: "Offline",
    pulse: false,
  },
  checking: {
    dot: "bg-accent",
    ring: "ring-accent/30",
    label: "Checking…",
    pulse: true,
  },
  disabled: {
    dot: "bg-text-muted",
    ring: "ring-text-muted/30",
    label: "Disabled",
    pulse: false,
  },
  unknown: {
    dot: "bg-text-muted",
    ring: "ring-text-muted/30",
    label: "Unknown",
    pulse: false,
  },
};

function resolveStatus(props) {
  if (props.status) return props.status;
  if (typeof props.active === "boolean") {
    return props.active ? "online" : "offline";
  }
  return "unknown";
}

/**
 * Universal status indicator.
 *
 * Usage:
 *   <StatusDot status="online" />
 *   <StatusDot status="offline" label="Ollama" />
 *   <StatusDot active={true} />  // legacy compatibility
 */
export function StatusDot({
  status,
  active,
  label,
  showLabel = false,
  size = "sm",
  title,
  className = "",
}) {
  const resolved = resolveStatus({ status, active });
  const style = STATUS_STYLES[resolved] || STATUS_STYLES.unknown;
  const sizeClass = size === "lg" ? "h-3 w-3" : "h-2 w-2";
  const ringClass = style.pulse
    ? `ring-2 ${style.ring} animate-pulse`
    : "";

  const tooltip = title || `${label || ""} ${style.label}`.trim();

  return (
    <span
      title={tooltip}
      className={`inline-flex items-center gap-2 ${className}`}
    >
      <span
        className={`inline-block rounded-full ${sizeClass} ${style.dot} ${ringClass}`}
      />
      {showLabel && (
        <span className="text-xs text-text-secondary">
          {label ? `${label}: ` : ""}
          {style.label}
        </span>
      )}
    </span>
  );
}
