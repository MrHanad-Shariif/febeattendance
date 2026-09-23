import { useMemo, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Inbox,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, downloadCsv } from "@/lib/utils";

/** Sortable column header. Use inside a column def: header: ({ column }) => <DataTableColumnHeader column={column} title="Name" /> */
export function DataTableColumnHeader({ column, title, className }) {
  if (!column.getCanSort()) return <div className={className}>{title}</div>;
  const sorted = column.getIsSorted();
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting(sorted === "asc")}
      className={cn("-ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 uppercase tracking-wide hover:text-foreground", className)}
    >
      {title}
      {sorted === "asc" ? (
        <ArrowUp className="h-3.5 w-3.5 text-primary" />
      ) : sorted === "desc" ? (
        <ArrowDown className="h-3.5 w-3.5 text-primary" />
      ) : (
        <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
      )}
    </button>
  );
}

/**
 * Advanced data table built on TanStack Table.
 *
 * Props:
 *  - columns, data: TanStack column defs + rows
 *  - loading: show skeleton rows
 *  - searchPlaceholder: enables the global search box when set
 *  - filters: [{ columnId, label, options?: [{value,label}] }] -> dropdown filters (options default to the column's unique values)
 *  - toolbar: extra nodes rendered in the toolbar (e.g. an "Add" button)
 *  - exportName: enables the CSV export button (exports the filtered rows, visible columns)
 *  - selectable: adds a row-selection column; renderBulkActions(selectedRows) shows when rows are selected
 *  - pageSize / pageSizes, emptyText, getRowId, initialSorting, initialVisibility
 * Columns can set meta: { className, noExport, exportValue: (row) => string }.
 */
export function DataTable({
  columns,
  data,
  loading = false,
  searchPlaceholder,
  filters = [],
  toolbar,
  exportName,
  selectable = false,
  renderBulkActions,
  pageSize = 10,
  pageSizes = [10, 20, 50, 100],
  emptyText = "No results.",
  getRowId,
  onRowClick,
  initialSorting = [],
  initialVisibility = {},
}) {
  const [sorting, setSorting] = useState(initialSorting);
  const [columnFilters, setColumnFilters] = useState([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [columnVisibility, setColumnVisibility] = useState(initialVisibility);
  const [rowSelection, setRowSelection] = useState({});

  const allColumns = useMemo(() => {
    if (!selectable) return columns;
    return [
      {
        id: "_select",
        enableSorting: false,
        enableHiding: false,
        meta: { noExport: true, className: "w-10" },
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllPageRowsSelected() ? true : table.getIsSomePageRowsSelected() ? "indeterminate" : false}
            onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox checked={row.getIsSelected()} onCheckedChange={(v) => row.toggleSelected(!!v)} aria-label="Select row" />
        ),
      },
      ...columns,
    ];
  }, [columns, selectable]);

  const table = useReactTable({
    data,
    columns: allColumns,
    state: { sorting, columnFilters, globalFilter, columnVisibility, rowSelection },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    globalFilterFn: "includesString",
    initialState: { pagination: { pageSize } },
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const filteredCount = table.getFilteredRowModel().rows.length;
  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const isFiltered = columnFilters.length > 0 || globalFilter !== "";
  const { pageIndex, pageSize: currentPageSize } = table.getState().pagination;
  const from = filteredCount === 0 ? 0 : pageIndex * currentPageSize + 1;
  const to = Math.min((pageIndex + 1) * currentPageSize, filteredCount);

  function handleExport() {
    const exportCols = visibleColumns.filter((c) => !c.columnDef.meta?.noExport && c.id !== "_select");
    const header = exportCols.map((c) => (typeof c.columnDef.header === "string" ? c.columnDef.header : c.columnDef.meta?.label || c.id));
    const rows = table.getFilteredRowModel().rows.map((row) =>
      exportCols.map((c) => {
        const custom = c.columnDef.meta?.exportValue;
        return custom ? custom(row.original) : row.getValue(c.id);
      })
    );
    downloadCsv(`${exportName}-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows]);
  }

  const hasToolbar = searchPlaceholder || filters.length > 0 || toolbar || exportName;

  return (
    <div className="space-y-3">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder && (
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="pl-8"
              />
            </div>
          )}

          {filters.map((f) => (
            <FacetFilter key={f.columnId} table={table} {...f} />
          ))}

          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setColumnFilters([]);
                setGlobalFilter("");
              }}
            >
              Reset <X className="h-3.5 w-3.5" />
            </Button>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {toolbar}
            {exportName && (
              <Button variant="outline" size="sm" onClick={handleExport} disabled={filteredCount === 0}>
                <Download /> Export CSV
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <SlidersHorizontal /> Columns
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel>Toggle columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllLeafColumns()
                  .filter((c) => c.getCanHide())
                  .map((c) => (
                    <DropdownMenuCheckboxItem
                      key={c.id}
                      checked={c.getIsVisible()}
                      onCheckedChange={(v) => c.toggleVisibility(!!v)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {typeof c.columnDef.header === "string" ? c.columnDef.header : c.columnDef.meta?.label || c.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {selectable && selectedRows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selectedRows.length} selected</span>
          {renderBulkActions?.(selectedRows, () => setRowSelection({}))}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setRowSelection({})}>
            Clear
          </Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader className="bg-muted/40">
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                    {header.isPlaceholder
                      ? null
                      : typeof header.column.columnDef.header === "string"
                      ? header.column.getCanSort()
                        ? <DataTableColumnHeader column={header.column} title={header.column.columnDef.header} />
                        : header.column.columnDef.header
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i} className="hover:bg-transparent">
                  {visibleColumns.map((c) => (
                    <TableCell key={c.id}>
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() ? "selected" : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  className={onRowClick ? "cursor-pointer" : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleColumns.length || 1} className="h-40 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Inbox className="h-8 w-8 opacity-50" />
                    <span className="text-sm">{isFiltered ? "No results match your filters." : emptyText}</span>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {loading ? "Loading..." : filteredCount === 0 ? "0 rows" : `${from}-${to} of ${filteredCount} row${filteredCount === 1 ? "" : "s"}`}
        </span>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">Rows per page</span>
            <Select value={String(currentPageSize)} onValueChange={(v) => table.setPageSize(Number(v))}>
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {pageSizes.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <span>
            Page {table.getPageCount() === 0 ? 0 : pageIndex + 1} of {table.getPageCount()}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()} aria-label="First page">
              <ChevronsLeft />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Previous page">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Next page">
              <ChevronRight />
            </Button>
            <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => table.setPageIndex(table.getPageCount() - 1)} disabled={!table.getCanNextPage()} aria-label="Last page">
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FacetFilter({ table, columnId, label, options }) {
  const column = table.getColumn(columnId);
  if (!column) return null;
  const value = column.getFilterValue() ?? "all";
  const opts =
    options ||
    Array.from(column.getFacetedUniqueValues().keys())
      .filter((v) => v !== null && v !== undefined && v !== "")
      .sort()
      .map((v) => ({ value: String(v), label: String(v) }));

  return (
    <Select value={String(value)} onValueChange={(v) => column.setFilterValue(v === "all" ? undefined : v)}>
      <SelectTrigger className={cn("h-9 w-auto min-w-[130px] gap-2", value !== "all" && "border-primary/50 bg-primary/5")}>
        <span className="text-muted-foreground">{label}:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        {opts.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** filterFn for columns filtered by exact value (used with `filters` above). */
export const exactFilter = (row, columnId, value) => String(row.getValue(columnId)) === String(value);
