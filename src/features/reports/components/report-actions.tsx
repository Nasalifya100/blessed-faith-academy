"use client";

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
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "print:hidden", className)}
      onClick={() => window.print()}
    >
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
  label = "Download CSV",
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
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "print:hidden", className)}
      onClick={onDownload}
    >
      {label}
    </button>
  );
}
