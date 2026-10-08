"use client";

import { cn } from "@/lib/utils";
import { Plus } from "lucide-react";
import { useState } from "react";

export interface AccordionItemData {
  question: string;
  answer: string;
}

export function Accordion({ items }: { items: AccordionItemData[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="divide-y divide-rz-border rounded-lg border border-rz-border bg-white">
      {items.map((item, i) => {
        const isOpen = openIndex === i;
        return (
          <div key={item.question}>
            <button
              type="button"
              className="rz-focus flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
              aria-expanded={isOpen}
              aria-controls={`faq-panel-${i}`}
              onClick={() => setOpenIndex(isOpen ? null : i)}
            >
              <span className="font-serif text-[15.5px] font-semibold text-rz-navy">
                {item.question}
              </span>
              <Plus
                className={cn(
                  "h-4 w-4 shrink-0 text-rz-maroon transition-transform duration-200",
                  isOpen && "rotate-45"
                )}
              />
            </button>
            <div
              id={`faq-panel-${i}`}
              role="region"
              className={cn("grid transition-all duration-200 ease-rz", isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
              style={{ display: "grid" }}
            >
              <div className="overflow-hidden">
                <p className="px-5 pb-4 text-sm leading-relaxed text-rz-muted">{item.answer}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
