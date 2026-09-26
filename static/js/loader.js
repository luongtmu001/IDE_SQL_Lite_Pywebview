/**
 * loader.js — Reusable Loading Modal Manager with custom .loader spinner.
 * Standardized across main IDE, BRAVO Tool, and all subwindows.
 */
(function (global) {
    'use strict';

    const AppLoader = {
        _modalEl: null,
        _bsModal: null,
        _textEl: null,
        _activeCount: 0,
        _hideTimer: null,

        _ensureElements() {
            if (this._modalEl) return;
            let el = document.getElementById('appLoadingModal');
            if (!el) {
                el = document.createElement('div');
                el.className = 'modal fade';
                el.id = 'appLoadingModal';
                el.tabIndex = -1;
                el.setAttribute('aria-hidden', 'true');
                el.setAttribute('data-bs-backdrop', 'static');
                el.setAttribute('data-bs-keyboard', 'false');
                el.innerHTML = `
                    <div class="modal-dialog modal-dialog-centered ide-loading-modal-dialog">
                        <div class="modal-content ide-loading-modal-content text-center p-4 d-flex flex-column align-items-center justify-content-center">
                            <div class="loader mb-3"></div>
                            <div id="appLoadingText" class="fw-semibold small" style="letter-spacing: 0.3px;">Đang tải...</div>
                        </div>
                    </div>
                `;
                document.body.appendChild(el);
            }
            this._modalEl = el;
            this._textEl = el.querySelector('#appLoadingText');
            if (window.bootstrap && window.bootstrap.Modal) {
                try {
                    this._bsModal = new window.bootstrap.Modal(this._modalEl, { backdrop: 'static', keyboard: false });
                } catch (_) {}
            }
        },

        show(text = 'Đang tải...') {
            this._activeCount++;
            if (this._hideTimer) {
                clearTimeout(this._hideTimer);
                this._hideTimer = null;
            }
            this._ensureElements();
            if (this._textEl) {
                this._textEl.textContent = text;
            }
            if (this._bsModal) {
                try {
                    this._bsModal.show();
                } catch (_) {}
            } else if (this._modalEl) {
                this._modalEl.style.display = 'block';
                this._modalEl.classList.add('show');
            }
        },

        hide(force = false) {
            if (force) this._activeCount = 0;
            else this._activeCount = Math.max(0, this._activeCount - 1);

            if (this._activeCount === 0) {
                this._hideTimer = setTimeout(() => {
                    if (this._activeCount === 0) {
                        if (this._bsModal) {
                            try {
                                this._bsModal.hide();
                            } catch (_) {}
                        } else if (this._modalEl) {
                            this._modalEl.style.display = 'none';
                            this._modalEl.classList.remove('show');
                        }
                        // Dọn dẹp backdrop tồn đọng nếu có
                        document.querySelectorAll('.modal-backdrop').forEach(b => {
                            if (!document.querySelector('.modal.show')) {
                                b.remove();
                                document.body.classList.remove('modal-open');
                                document.body.style.removeProperty('overflow');
                                document.body.style.removeProperty('padding-right');
                            }
                        });
                    }
                }, 150);
            }
        }
    };

    global.AppLoader = AppLoader;
})(window);
