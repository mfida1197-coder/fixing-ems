import { LuMoon, LuSun } from "react-icons/lu";

type ThemeToggleProps = {
  theme: "light" | "dark";
  onToggle: () => void;
  compact?: boolean;
};

export default function ThemeToggle({ theme, onToggle, compact = false }: ThemeToggleProps) {
  const nextTheme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className={`theme-toggle${compact ? " theme-toggle-compact" : ""}`}
      onClick={onToggle}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
        {theme === "light" ? <LuMoon size={16} /> : <LuSun size={16} />}
      </span>
      {!compact && <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>}
    </button>
  );
}

