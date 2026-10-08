import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Previous / next with a "Page x of y" label; hidden when there is only one page. */
export function Pager({
  page,
  totalPages,
  onPage,
  disabled,
  label = "Pagination",
}: {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label={label} className="mt-8 flex items-center justify-center gap-3">
      <Button type="button" size="sm" variant="outline" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft className="h-4 w-4" />}>
        Previous
      </Button>
      <span className="text-sm text-rz-muted" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <Button type="button" size="sm" variant="outline" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)} icon={<ChevronRight className="h-4 w-4" />} iconPosition="right">
        Next
      </Button>
    </nav>
  );
}
