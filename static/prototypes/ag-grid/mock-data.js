/**
 * mock-data.js
 * Generator tạo dữ liệu mẫu độc lập cho AG Grid Prototype.
 * Hỗ trợ các kiểu dữ liệu: Integer, Decimal, Boolean, String, NULL, DateTime, Long text, Enum.
 * Sử dụng pseudo-random PRNG với seed cố định để đảm bảo kết quả tái tạo được 100%.
 */

(function (global) {
    'use strict';

    // Linear Congruential Generator (LCG) for reproducible pseudo-random numbers
    function createPRNG(seed = 123456789) {
        let current = seed >>> 0;
        return function next() {
            // Numerical Recipes constants: a = 1664525, c = 1013904223, m = 2^32
            current = (Math.imul(1664525, current) + 1013904223) >>> 0;
            return current / 4294967296;
        };
    }

    const FIRST_NAMES = [
        'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
        'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan', 'Joseph', 'Jessica',
        'Thomas', 'Sarah', 'Charles', 'Karen', 'Christopher', 'Nancy', 'Daniel', 'Lisa'
    ];

    const LAST_NAMES = [
        'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
        'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas',
        'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White'
    ];

    const CITIES = [
        'New York', 'London', 'Tokyo', 'Paris', 'Berlin', 'Singapore', 'Sydney', 'Toronto',
        'Hanoi', 'Ho Chi Minh', 'Da Nang', 'Seoul', 'Bangkok', 'Amsterdam', 'Frankfurt', 'Dubai'
    ];

    const STATUS_ENUM = ['ACTIVE', 'PENDING', 'SUSPENDED', 'COMPLETED', 'ARCHIVED', 'FAILED'];

    const LOREM_WORDS = [
        'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
        'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
        'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation'
    ];

    function randomLorem(rand, count = 10) {
        const words = [];
        for (let i = 0; i < count; i++) {
            const idx = Math.floor(rand() * LOREM_WORDS.length);
            words.push(LOREM_WORDS[idx]);
        }
        return words.join(' ');
    }

    function formatDate(d) {
        const pad = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    const MockDataGenerator = {
        /**
         * Sinh tập column definitions và row data cho AG Grid
         * @param {number} rowCount Số dòng (100, 2000, 10000, 20000...)
         * @param {number} colCount Số cột (10, 20, 50, 100...)
         * @param {number} seed Seed số ngẫu nhiên
         */
        generateDataset(rowCount = 1000, colCount = 20, seed = 42) {
            const rand = createPRNG(seed);
            const colDefs = [];

            // ── 1. Cấu hình các cột tiêu chuẩn ─────────────────────────────────────────
            // Cột Row Number (Pin Left)
            colDefs.push({
                headerName: '#',
                valueGetter: 'node.rowIndex + 1',
                width: 70,
                minWidth: 50,
                pinned: 'left',
                sortable: false,
                filter: false,
                resizable: true,
                cellClass: 'ag-cell-row-number'
            });

            // Cột ID
            colDefs.push({
                field: 'id',
                headerName: 'ID',
                width: 90,
                minWidth: 70,
                filter: 'agNumberColumnFilter',
                sortable: true,
                resizable: true,
                cellClass: 'ag-cell-numeric'
            });

            // Cột Name
            if (colCount > 1) {
                colDefs.push({
                    field: 'full_name',
                    headerName: 'Customer Name',
                    width: 180,
                    minWidth: 120,
                    filter: 'agTextColumnFilter',
                    sortable: true,
                    resizable: true
                });
            }

            // Cột Status (Enum)
            if (colCount > 2) {
                colDefs.push({
                    field: 'status',
                    headerName: 'Status',
                    width: 130,
                    minWidth: 100,
                    filter: 'agTextColumnFilter',
                    sortable: true,
                    resizable: true,
                    cellClass: params => `ag-status-${(params.value || '').toLowerCase()}`
                });
            }

            // Cột City
            if (colCount > 3) {
                colDefs.push({
                    field: 'city',
                    headerName: 'Location',
                    width: 140,
                    minWidth: 100,
                    filter: 'agTextColumnFilter',
                    sortable: true,
                    resizable: true
                });
            }

            // Cột Amount (Decimal)
            if (colCount > 4) {
                colDefs.push({
                    field: 'amount',
                    headerName: 'Total Balance ($)',
                    width: 150,
                    minWidth: 110,
                    filter: 'agNumberColumnFilter',
                    sortable: true,
                    resizable: true,
                    cellClass: 'ag-cell-numeric',
                    valueFormatter: params => {
                        if (params.value === null || params.value === undefined) return '';
                        return Number(params.value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                    }
                });
            }

            // Cột Score (Integer)
            if (colCount > 5) {
                colDefs.push({
                    field: 'score',
                    headerName: 'Score',
                    width: 110,
                    minWidth: 80,
                    filter: 'agNumberColumnFilter',
                    sortable: true,
                    resizable: true,
                    cellClass: 'ag-cell-numeric'
                });
            }

            // Cột Is Active (Boolean)
            if (colCount > 6) {
                colDefs.push({
                    field: 'is_active',
                    headerName: 'Active',
                    width: 100,
                    minWidth: 80,
                    filter: true,
                    sortable: true,
                    resizable: true,
                    cellRenderer: params => {
                        if (params.value === null) return '<span class="ag-null-value">NULL</span>';
                        return params.value ? '<span class="badge-bool-true">TRUE</span>' : '<span class="badge-bool-false">FALSE</span>';
                    }
                });
            }

            // Cột Created At (DateTime)
            if (colCount > 7) {
                colDefs.push({
                    field: 'created_at',
                    headerName: 'Registered Date',
                    width: 170,
                    minWidth: 140,
                    filter: 'agDateColumnFilter',
                    sortable: true,
                    resizable: true
                });
            }

            // Cột Notes (Long text)
            if (colCount > 8) {
                colDefs.push({
                    field: 'notes',
                    headerName: 'Remarks / Notes',
                    width: 250,
                    minWidth: 180,
                    filter: 'agTextColumnFilter',
                    sortable: true,
                    resizable: true
                });
            }

            // Cột Nullable Field
            if (colCount > 9) {
                colDefs.push({
                    field: 'nullable_info',
                    headerName: 'Optional Info',
                    width: 150,
                    minWidth: 120,
                    filter: 'agTextColumnFilter',
                    sortable: true,
                    resizable: true,
                    cellRenderer: params => {
                        if (params.value === null || params.value === undefined) {
                            return '<span class="ag-null-value">NULL</span>';
                        }
                        return String(params.value);
                    }
                });
            }

            // Sinh thêm các cột động nếu colCount > 10
            for (let c = colDefs.length - 1; c < colCount; c++) {
                const colType = c % 4; // 0: Number, 1: Text, 2: Decimal, 3: Date
                const fieldName = `col_${c + 1}`;
                let header = `Col ${c + 1}`;
                let filterType = 'agTextColumnFilter';
                let cellClass = '';

                if (colType === 0) {
                    header += ' (Int)';
                    filterType = 'agNumberColumnFilter';
                    cellClass = 'ag-cell-numeric';
                } else if (colType === 1) {
                    header += ' (Str)';
                } else if (colType === 2) {
                    header += ' (Dec)';
                    filterType = 'agNumberColumnFilter';
                    cellClass = 'ag-cell-numeric';
                } else {
                    header += ' (Date)';
                    filterType = 'agDateColumnFilter';
                }

                colDefs.push({
                    field: fieldName,
                    headerName: header,
                    width: 140,
                    minWidth: 100,
                    filter: filterType,
                    sortable: true,
                    resizable: true,
                    cellClass: cellClass,
                    cellRenderer: params => {
                        if (params.value === null || params.value === undefined) {
                            return '<span class="ag-null-value">NULL</span>';
                        }
                        return String(params.value);
                    }
                });
            }

            // ── 2. Sinh rowData ────────────────────────────────────────────────────────
            const rows = [];
            const baseDate = new Date(2024, 0, 1).getTime();

            for (let r = 0; r < rowCount; r++) {
                const id = r + 1;
                const fName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
                const lName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
                const status = STATUS_ENUM[Math.floor(rand() * STATUS_ENUM.length)];
                const city = CITIES[Math.floor(rand() * CITIES.length)];
                const amount = Number((rand() * 50000).toFixed(2));
                const score = Math.floor(rand() * 1000);
                const isActive = rand() > 0.3;
                const dateOffset = Math.floor(rand() * 86400000 * 365);
                const createdAt = formatDate(new Date(baseDate + dateOffset));
                const notes = randomLorem(rand, 6 + Math.floor(rand() * 8));
                const nullableInfo = (rand() < 0.15) ? null : `DATA-${Math.floor(rand() * 9000 + 1000)}`;

                const rowObj = {
                    id,
                    full_name: `${fName} ${lName}`,
                    status,
                    city,
                    amount,
                    score,
                    is_active: isActive,
                    created_at: createdAt,
                    notes,
                    nullable_info: nullableInfo
                };

                // Fill additional dynamic columns
                for (let c = 10; c < colCount; c++) {
                    const colKey = `col_${c + 1}`;
                    const colType = c % 4;
                    if (rand() < 0.08) {
                        rowObj[colKey] = null;
                    } else if (colType === 0) {
                        rowObj[colKey] = Math.floor(rand() * 10000);
                    } else if (colType === 1) {
                        rowObj[colKey] = `ITEM-${Math.floor(rand() * 9999)}`;
                    } else if (colType === 2) {
                        rowObj[colKey] = Number((rand() * 1000).toFixed(4));
                    } else {
                        rowObj[colKey] = formatDate(new Date(baseDate + Math.floor(rand() * 86400000 * 200)));
                    }
                }

                rows.push(rowObj);
            }

            return { colDefs, rowData: rows };
        },

        /**
         * Sinh batch dữ liệu thêm (dành cho Append 1,000 Rows test)
         */
        generateAppendRows(startId, count = 1000, colCount = 20, seed = null) {
            const rand = createPRNG(seed || (startId * 17 + count));
            const baseDate = new Date(2025, 0, 1).getTime();
            const rows = [];

            for (let i = 0; i < count; i++) {
                const id = startId + i;
                const fName = FIRST_NAMES[Math.floor(rand() * FIRST_NAMES.length)];
                const lName = LAST_NAMES[Math.floor(rand() * LAST_NAMES.length)];
                const status = STATUS_ENUM[Math.floor(rand() * STATUS_ENUM.length)];
                const city = CITIES[Math.floor(rand() * CITIES.length)];
                const amount = Number((rand() * 50000).toFixed(2));
                const score = Math.floor(rand() * 1000);
                const isActive = rand() > 0.3;
                const createdAt = formatDate(new Date(baseDate + Math.floor(rand() * 86400000 * 100)));
                const notes = randomLorem(rand, 6);
                const nullableInfo = (rand() < 0.15) ? null : `APPEND-${id}`;

                const rowObj = {
                    id,
                    full_name: `${fName} ${lName}`,
                    status,
                    city,
                    amount,
                    score,
                    is_active: isActive,
                    created_at: createdAt,
                    notes,
                    nullable_info: nullableInfo
                };

                for (let c = 10; c < colCount; c++) {
                    const colKey = `col_${c + 1}`;
                    const colType = c % 4;
                    if (rand() < 0.08) {
                        rowObj[colKey] = null;
                    } else if (colType === 0) {
                        rowObj[colKey] = Math.floor(rand() * 10000);
                    } else if (colType === 1) {
                        rowObj[colKey] = `BATCH-${id}`;
                    } else if (colType === 2) {
                        rowObj[colKey] = Number((rand() * 1000).toFixed(4));
                    } else {
                        rowObj[colKey] = formatDate(new Date(baseDate + Math.floor(rand() * 86400000 * 50)));
                    }
                }

                rows.push(rowObj);
            }

            return rows;
        }
    };

    global.MockDataGenerator = MockDataGenerator;
})(window);
