"use client";

export function ThinkingDots() {
  return (
    <div className="flex items-center gap-1">
      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        .dot { animation: bounce 1.2s ease-in-out infinite; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
      `}</style>
      <span className="dot h-2 w-2 rounded-full bg-text-secondary" />
      <span className="dot h-2 w-2 rounded-full bg-text-secondary" />
      <span className="dot h-2 w-2 rounded-full bg-text-secondary" />
    </div>
  );
}
