import { cn } from "@/lib/utils";
import { InputHTMLAttributes, LabelHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export function FieldLabel({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[12.5px] font-semibold text-rz-muted", className)}
      {...props}
    />
  );
}

const fieldBase =
  "rz-focus w-full rounded-md border border-rz-border bg-rz-ivory text-[15px] text-rz-text placeholder:text-rz-muted/70 transition-colors duration-150 hover:border-rz-maroon/40 focus-visible:border-rz-maroon disabled:opacity-60";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, icon, ...props },
  ref
) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-rz-maroon">
          {icon}
        </span>
      )}
      <input
        ref={ref}
        className={cn(fieldBase, "h-12 px-4", icon && "pl-10", className)}
        {...props}
      />
    </div>
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  icon?: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, icon, children, ...props },
  ref
) {
  return (
    <div className="relative">
      {icon && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-rz-maroon">
          {icon}
        </span>
      )}
      <select
        ref={ref}
        className={cn(
          fieldBase,
          "h-12 appearance-none cursor-pointer px-4 pr-9",
          icon && "pl-10",
          className
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-rz-muted" />
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(fieldBase, "min-h-[120px] px-4 py-3", className)}
        {...props}
      />
    );
  }
);
