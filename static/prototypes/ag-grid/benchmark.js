/**
 * benchmark.js
 * Bộ công cụ đo lường hiệu năng frontend chuyên dụng cho AG Grid Prototype.
 * Sử dụng performance.now() và requestAnimationFrame để đo thời gian thực thi,
 * thời gian render giao diện, và số lượng DOM nodes.
 */

(function (global) {
    'use strict';

    class BenchmarkRunner {
        constructor() {
            this.history = [];
            this.listeners = [];
        }

        /**
         * Đo thời gian thực thi của một tác vụ đồng bộ hoặc bất đồng bộ
         * kèm thời gian đến khi frame đồ họa kế tiếp hoàn thành (visual update)
         */
        async measureAsync(taskName, fn) {
            const t0 = performance.now();
            let result;
            let executionTime = 0;

            try {
                result = await fn();
                executionTime = performance.now() - t0;
            } catch (err) {
                console.error(`[Benchmark] Error during "${taskName}":`, err);
                throw err;
            }

            // Đo thời điểm browser layout & paint xong frame kế tiếp (visual update)
            const visualUpdateTime = await new Promise(resolve => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        resolve(performance.now() - t0);
                    }, 0);
                });
            });

            const entry = {
                task: taskName,
                timestamp: new Date().toLocaleTimeString(),
                executionTimeMs: Number(executionTime.toFixed(2)),
                visualUpdateMs: Number(visualUpdateTime.toFixed(2)),
                result
            };

            this.history.push(entry);
            this.notify(entry);
            return entry;
        }

        /**
         * Đếm số lượng DOM nodes bên trong container
         */
        countDomNodes(containerElement) {
            if (!containerElement) return 0;
            return containerElement.getElementsByTagName('*').length;
        }

        /**
         * Chạy chuỗi benchmark tiêu chuẩn toàn diện:
         * 1. Sinh dữ liệu (Data Generation)
         * 2. Khởi tạo Grid (Grid Init)
         * 3. Cập nhật dữ liệu (Data Update)
         * 4. Thêm batch 1.000 dòng (Batch Append)
         * 5. Đo số lượng DOM nodes
         */
        async runSuite(options) {
            const {
                gridWrapper,
                rowCount = 2000,
                colCount = 20,
                onStatus
            } = options;

            const report = {
                config: { rowCount, colCount },
                metrics: {},
                domNodes: 0
            };

            if (onStatus) onStatus('Đang đo: Sinh dữ liệu mẫu...');
            let dataset;
            const genRes = await this.measureAsync(`Generate ${rowCount} rows × ${colCount} cols`, () => {
                dataset = global.MockDataGenerator.generateDataset(rowCount, colCount, 999);
            });
            report.metrics.dataGenMs = genRes.executionTimeMs;

            if (onStatus) onStatus('Đang đo: Nạp dữ liệu vào AG Grid...');
            const updateRes = await this.measureAsync(`Render ${rowCount} rows in Grid`, async () => {
                if (options.applyDataset) {
                    await options.applyDataset(dataset);
                }
            });
            report.metrics.renderMs = updateRes.executionTimeMs;
            report.metrics.visualMs = updateRes.visualUpdateMs;

            if (onStatus) onStatus('Đang đo: Thêm batch 1,000 dòng (applyTransaction)...');
            const appendData = global.MockDataGenerator.generateAppendRows(rowCount + 1, 1000, colCount);
            const appendRes = await this.measureAsync('Append 1,000 rows', async () => {
                if (options.appendRows) {
                    await options.appendRows(appendData);
                }
            });
            report.metrics.appendMs = appendRes.executionTimeMs;
            report.metrics.appendVisualMs = appendRes.visualUpdateMs;

            report.domNodes = this.countDomNodes(gridWrapper);

            if (onStatus) onStatus('Hoàn thành kiểm thử hiệu năng!');
            return report;
        }

        addListener(fn) {
            this.listeners.push(fn);
        }

        notify(entry) {
            this.listeners.forEach(fn => {
                try { fn(entry); } catch (_) {}
            });
        }

        clearHistory() {
            this.history = [];
        }
    }

    global.Benchmark = new BenchmarkRunner();
})(window);
