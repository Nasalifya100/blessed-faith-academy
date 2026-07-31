/**
 * Server-side pagination bounds for large school lists.
 */

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
export const MAX_EXPORT_ROWS = 2_000;
export const MAX_LIST_ROWS = 2_000;

export type PageParams = {
  page: number;
  pageSize: number;
  offset: number;
};

export function normalizePageParams(input: {
  page?: number | string | null;
  pageSize?: number | string | null;
  defaultPageSize?: number;
  maxPageSize?: number;
}): PageParams {
  const defaultPageSize = input.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const maxPageSize = input.maxPageSize ?? MAX_PAGE_SIZE;

  const rawPage = Number(input.page ?? 1);
  const rawSize = Number(input.pageSize ?? defaultPageSize);

  const page =
    Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
  let pageSize =
    Number.isFinite(rawSize) && rawSize >= 1
      ? Math.floor(rawSize)
      : defaultPageSize;
  pageSize = Math.min(pageSize, maxPageSize);

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function clampListLimit(requested: number | undefined | null): number {
  if (requested == null || !Number.isFinite(requested) || requested < 1) {
    return MAX_LIST_ROWS;
  }
  return Math.min(Math.floor(requested), MAX_LIST_ROWS);
}
