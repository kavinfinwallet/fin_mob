import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  TablePagination,
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  Toolbar,
  Tooltip,
  Menu,
  MenuItem,
  FormControlLabel,
  Switch,
  Chip,
} from '@mui/material';
import {
  Search as SearchIcon,
  ViewColumn as ViewColumnIcon,
  DensityMedium as DensityMediumIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import './MUITable.css';

const MUITable = ({
  data,
  columns,
  enableSorting = true,
  enablePagination = true,
  enableFiltering = true,
  enableColumnVisibility = true,
  enableDensity = true,
  enableExport = true,
  pageSize = 10,
  className = '',
  title = '',
}) => {
  const [orderBy, setOrderBy] = useState(null);
  const [order, setOrder] = useState('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(pageSize);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [visibleColumns, setVisibleColumns] = useState(
    columns.reduce((acc, col) => {
      acc[col.accessorKey || col.id] = col.hidden !== true;
      return acc;
    }, {})
  );
  const [density, setDensity] = useState('medium');
  const [filterMenuAnchor, setFilterMenuAnchor] = useState(null);
  const [columnMenuAnchor, setColumnMenuAnchor] = useState(null);

  const handleRequestSort = (property) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (event, newPage) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleColumnVisibility = (columnKey) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [columnKey]: !prev[columnKey],
    }));
  };

  const handleExport = () => {
    const visibleCols = columns.filter((col) => visibleColumns[col.accessorKey || col.id]);
    const csvContent = [
      // Header
      visibleCols.map((col) => col.header).join(','),
      // Rows
      ...sortedData.map((row) =>
        visibleCols
          .map((col) => {
            const value = col.cell
              ? col.cell({ row: { original: row }, getValue: () => row[col.accessorKey] })
              : row[col.accessorKey];
            const stringValue = String(value ?? '');
            return stringValue.includes(',') || stringValue.includes('"')
              ? `"${stringValue.replace(/"/g, '""')}"`
              : stringValue;
          })
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  // Filter data
  const filteredData = React.useMemo(() => {
    let result = data;

    // Global filter
    if (globalFilter) {
      result = result.filter((row) => {
        return columns.some((col) => {
          const value = row[col.accessorKey];
          return String(value || '')
            .toLowerCase()
            .includes(globalFilter.toLowerCase());
        });
      });
    }

    // Column filters
    Object.keys(columnFilters).forEach((key) => {
      if (columnFilters[key]) {
        result = result.filter((row) => {
          const value = String(row[key] || '').toLowerCase();
          return value.includes(columnFilters[key].toLowerCase());
        });
      }
    });

    return result;
  }, [data, globalFilter, columnFilters, columns]);

  // Sort data
  const sortedData = React.useMemo(() => {
    if (!orderBy || !enableSorting) return filteredData;

    return [...filteredData].sort((a, b) => {
      const aValue = a[orderBy];
      const bValue = b[orderBy];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return order === 'asc'
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      if (typeof aValue === 'number' && typeof bValue === 'number') {
        return order === 'asc' ? aValue - bValue : bValue - aValue;
      }

      return order === 'asc'
        ? String(aValue).localeCompare(String(bValue))
        : String(bValue).localeCompare(String(aValue));
    });
  }, [filteredData, orderBy, order, enableSorting]);

  // Paginate data
  const paginatedData = React.useMemo(() => {
    if (!enablePagination) return sortedData;
    return sortedData.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
  }, [sortedData, page, rowsPerPage, enablePagination]);

  // Get visible columns
  const visibleColumnsList = columns.filter(
    (col) => visibleColumns[col.accessorKey || col.id]
  );

  const densityPadding = {
    compact: '8px 12px',
    medium: '14px 20px',
    comfortable: '20px 24px',
  };

  return (
    <Box className={`mui-table-container ${className}`}>
      {(enableFiltering || enableColumnVisibility || enableDensity || enableExport || title) && (
        <Toolbar className="mui-table-toolbar">
          {title && (
            <Typography variant="h6" component="div" sx={{ flex: '1 1 100%' }}>
              {title}
            </Typography>
          )}
          
          {enableFiltering && (
            <TextField
              size="small"
              placeholder="Search..."
              value={globalFilter}
              onChange={(e) => setGlobalFilter(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ mr: 2, minWidth: 200 }}
            />
          )}

          {enableColumnVisibility && (
            <>
              <Tooltip title="Column visibility">
                <IconButton onClick={(e) => setColumnMenuAnchor(e.currentTarget)}>
                  <ViewColumnIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={columnMenuAnchor}
                open={Boolean(columnMenuAnchor)}
                onClose={() => setColumnMenuAnchor(null)}
              >
                {columns.map((col) => (
                  <MenuItem key={col.accessorKey || col.id}>
                    <FormControlLabel
                      control={
                        <Switch
                          checked={visibleColumns[col.accessorKey || col.id]}
                          onChange={() => handleColumnVisibility(col.accessorKey || col.id)}
                        />
                      }
                      label={col.header}
                    />
                  </MenuItem>
                ))}
              </Menu>
            </>
          )}

          {enableDensity && (
            <>
              <Tooltip title="Density">
                <IconButton onClick={(e) => setFilterMenuAnchor(e.currentTarget)}>
                  <DensityMediumIcon />
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={filterMenuAnchor}
                open={Boolean(filterMenuAnchor)}
                onClose={() => setFilterMenuAnchor(null)}
              >
                <MenuItem onClick={() => { setDensity('compact'); setFilterMenuAnchor(null); }}>
                  Compact
                </MenuItem>
                <MenuItem onClick={() => { setDensity('medium'); setFilterMenuAnchor(null); }}>
                  Medium
                </MenuItem>
                <MenuItem onClick={() => { setDensity('comfortable'); setFilterMenuAnchor(null); }}>
                  Comfortable
                </MenuItem>
              </Menu>
            </>
          )}

          {enableExport && (
            <Tooltip title="Export CSV">
              <IconButton onClick={handleExport}>
                <DownloadIcon />
              </IconButton>
            </Tooltip>
          )}
        </Toolbar>
      )}

      <TableContainer component={Paper} className="mui-table-wrapper" elevation={3}>
        <Table stickyHeader className="mui-table">
          <TableHead>
            <TableRow className="mui-table-header-row">
              {visibleColumnsList.map((column) => (
                <TableCell
                  key={column.accessorKey || column.id}
                  className="mui-table-header-cell"
                  sortDirection={orderBy === column.accessorKey ? order : false}
                  sx={{ padding: densityPadding[density] }}
                >
                  {enableSorting && column.accessorKey ? (
                    <TableSortLabel
                      active={orderBy === column.accessorKey}
                      direction={orderBy === column.accessorKey ? order : 'asc'}
                      onClick={() => handleRequestSort(column.accessorKey)}
                      className="mui-sort-label"
                    >
                      {column.header}
                    </TableSortLabel>
                  ) : (
                    <Typography variant="subtitle2" fontWeight={600}>
                      {column.header}
                    </Typography>
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={visibleColumnsList.length}
                  align="center"
                  className="mui-no-data"
                >
                  <Typography variant="body2" color="text.secondary">
                    No data available
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => (
                <TableRow
                  key={row.id || index}
                  className="mui-table-row"
                  hover
                  sx={{
                    '&:nth-of-type(odd)': {
                      backgroundColor: 'action.hover',
                    },
                    '&:hover': {
                      backgroundColor: 'action.selected',
                    },
                  }}
                >
                  {visibleColumnsList.map((column) => {
                    const cellValue = column.cell
                      ? column.cell({
                          row: { original: row },
                          getValue: () => row[column.accessorKey],
                        })
                      : row[column.accessorKey];

                    return (
                      <TableCell
                        key={column.accessorKey || column.id}
                        className="mui-table-cell"
                        sx={{ padding: densityPadding[density] }}
                      >
                        {cellValue ?? '-'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {enablePagination && (
        <TablePagination
          component="div"
          count={sortedData.length}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          rowsPerPageOptions={[5, 10, 25, 50, 100]}
          className="mui-pagination"
        />
      )}

      {enableFiltering && Object.keys(columnFilters).length > 0 && (
        <Box className="mui-active-filters">
          <Typography variant="caption" sx={{ mr: 1 }}>
            Active filters:
          </Typography>
          {Object.entries(columnFilters).map(([key, value]) => (
            value && (
              <Chip
                key={key}
                label={`${key}: ${value}`}
                onDelete={() => {
                  setColumnFilters((prev) => {
                    const newFilters = { ...prev };
                    delete newFilters[key];
                    return newFilters;
                  });
                }}
                size="small"
                sx={{ mr: 0.5 }}
              />
            )
          ))}
        </Box>
      )}
    </Box>
  );
};

export default MUITable;
