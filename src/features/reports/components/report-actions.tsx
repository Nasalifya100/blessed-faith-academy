"use client";

import { Download, Printer } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PrintReportButtonProps {
  label?: string;
  className?: string;
}

export function PrintReportButton({
  label = "Print",
  className,
}: PrintReportButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "print:hidden",
        className,
      )}
      onClick={() => window.print()}
      aria-label={label}
    >
      <Printer className="size-4" aria-hidden />
      {label}
    </button>
  );
}

interface DownloadCsvButtonProps {
  filename: string;
  csv: string;
  label?: string;
  className?: string;
}

export function DownloadCsvButton({
  filename,
  csv,
  label = "Export CSV",
  className,
}: DownloadCsvButtonProps) {
  function onDownload() {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      type="button"
      className={cn(
        buttonVariants({ variant: "outline", size: "sm" }),
        "print:hidden",
        className,
      )}
      onClick={onDownload}
      aria-label={label}
    >
      <Download className="size-4" aria-hidden />
      {label}
    </button>
  );
}
