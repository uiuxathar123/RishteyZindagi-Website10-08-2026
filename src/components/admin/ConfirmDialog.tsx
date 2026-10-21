"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "./AdminUi";

/** The admin panel's own confirmation dialog (instead of the browser's window.confirm). */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={pending}>
            Go back
          </Button>
          <Button variant={danger ? "outline" : undefined} onClick={onConfirm} disabled={pending} aria-busy={pending}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-rz-text">{children}</div>
    </Modal>
  );
}
