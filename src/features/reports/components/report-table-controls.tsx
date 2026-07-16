"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const DEFAULT_PAGE_SIZE = 25;

export function ReportTableToolbar({
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  resultCount,
  totalCount,
  className,
}: {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  resultCount: number;
  totalCount: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="h-11 pl-9"
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Showing {resultCount} of {totalCount}
      </p>
    </div>
  );
}

export function ReportPagination({
  page,
  pageCount,
  onPageChange,
  className,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-2 print:hidden",
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        Page {page} of {pageCount}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-10"
          disabled={page >= pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

export function useClientPagedList<T>(
  items: T[],
  matches: (item: T, query: string) => boolean,
  pageSize: number = DEFAULT_PAGE_SIZE,
) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => matches(item, q));
    // matches is expected to be a stable module-level function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, pageSize, safePage]);

  function onSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  return {
    search,
    onSearchChange,
    page: safePage,
    setPage,
    pageCount,
    pageItems,
    filteredCount: filtered.length,
    totalCount: items.length,
  };
}
