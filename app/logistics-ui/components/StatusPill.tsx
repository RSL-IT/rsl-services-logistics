// app/logistics-ui/components/StatusPill.tsx
import React from "react";

type Tone = "green" | "red";

interface StatusPillProps {
  tone: Tone;
  label: string;
  onClick?: () => void;
  title?: string;
}

const baseStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 10px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  border: "1px solid transparent",
  userSelect: "none",
  lineHeight: 1.2,
};

function toneStyle(tone: Tone): React.CSSProperties {
  if (tone === "green") {
    return {
      backgroundColor: "#dcfce7",
      color: "#166534",
      borderColor: "#bbf7d0",
    };
  }
  return {
    backgroundColor: "#fee2e2",
    color: "#b91c1c",
    borderColor: "#fecaca",
  };
}

export function StatusPill({ tone, label, onClick, title }: StatusPillProps) {
  const clickable = typeof onClick === "function";

  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        ...baseStyle,
        ...toneStyle(tone),
        cursor: clickable ? "pointer" : "default",
        opacity: clickable ? 1 : 0.95,
      }}
      disabled={!clickable}
    >
      {label}
    </button>
  );
}

export default StatusPill;
