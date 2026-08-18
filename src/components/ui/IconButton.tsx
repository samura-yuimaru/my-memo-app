"use client";

import { forwardRef } from "react";
import clsx from "clsx";

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  active?: boolean;
  size?: "sm" | "md" | "lg";
}

/** アイコンのみのボタン。labelはtitle/aria-labelとして使い、ツールチップも兼ねる */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, active, size = "md", className, children, ...rest }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        title={label}
        aria-label={label}
        className={clsx(
          "inline-flex items-center justify-center rounded-md text-ink-500 transition-colors",
          "hover:bg-ink-100 hover:text-ink-800 active:bg-ink-200",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400",
          "disabled:pointer-events-none disabled:opacity-30",
          size === "sm" ? "h-7 w-7" : size === "lg" ? "h-11 w-11" : "h-9 w-9",
          active && "bg-accent-50 text-accent-600 hover:bg-accent-100 hover:text-accent-700",
          className
        )}
        {...rest}
      >
        {children}
      </button>
    );
  }
);
IconButton.displayName = "IconButton";
