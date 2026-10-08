"use client";

import { cn } from "@/lib/utils";
import { ReactNode, useState } from "react";

export interface TabItem {
  id: string;
  label: string;
  badge?: number;
}

/** Lightweight controlled/uncontrolled tab strip — used for Profile edit
 * sections, Interests Received/Sent, Messages, etc. Renders only the
 * active panel's children (passed as a render-prop keyed by tab id) so
 * inactive tabs cost nothing. */
export function Tabs({
  items,
  defaultTab,
  activeTab,
  onChange,
  children,
}: {
  items: TabItem[];
  defaultTab?: string;
  activeTab?: string;
  onChange?: (id: string) => void;
  children: (activeId: string) => ReactNode;
}) {
  const [internalTab, setInternalTab] = useState(defaultTab ?? items[0]?.id);
  const active = activeTab ?? internalTab;

  function select(id: string) {
    if (onChange) onChange(id);
    else setInternalTab(id);
  }

  return (
    <div>
      <div role="tablist" className="flex flex-wrap gap-1.5 border-b border-rz-border">
        {items.map((item) => {
          const isActive = item.id === active;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => select(item.id)}
              className={cn(
                "rz-focus relative flex items-center gap-1.5 px-4 py-2.5 text-[13.5px] font-semibold transition-colors",
                isActive ? "text-rz-maroon" : "text-rz-muted hover:text-rz-text"
              )}
            >
              {item.label}
              {typeof item.badge === "number" && item.badge > 0 && (
                <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rz-maroon px-1.5 text-[11px] font-bold text-white">
                  {item.badge}
                </span>
              )}
              {isActive && (
                <span className="absolute -bottom-px left-0 right-0 h-0.5 rounded-full bg-rz-maroon" />
              )}
            </button>
          );
        })}
      </div>
      <div className="pt-5">{children(active)}</div>
    </div>
  );
}
