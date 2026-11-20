import type { ReactNode } from "react";
import cx from "classnames";
import styles from "./qa.module.less";

export interface PillOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

/** Refined pill segmented control (sliding-feel active pill, soft shadow). */
export function PillSegmented<T extends string>({
  value,
  onChange,
  options,
  size = "sm",
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  options: PillOption<T>[];
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <div
      className={cx(styles.pill, size === "md" && styles.pillMd)}
      role="tablist"
      aria-label={ariaLabel}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          className={cx(
            styles.pillItem,
            o.value === value && styles.pillItemActive,
          )}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <span className={styles.pillIcon}>{o.icon}</span> : null}
          <span className={styles.pillLabel}>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** Ghost pill tool button (export / actions) with hover brand tint. */
export function ToolButton({
  icon,
  children,
  onClick,
  title,
}: {
  icon?: ReactNode;
  children?: ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={styles.toolBtn}
      onClick={onClick}
      title={title}
    >
      {icon ? <span className={styles.toolBtnIcon}>{icon}</span> : null}
      {children ? <span>{children}</span> : null}
    </button>
  );
}
