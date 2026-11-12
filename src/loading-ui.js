// Presentational placeholders only: requests, recovery and stale-response guards
// remain owned by the existing mail/calendar/contact flows.
(function (root) {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const bar = (size = '') => `<span class="skeleton-bar ${size}"></span>`;
  const row = () => `<div class="skeleton-row">${bar('skeleton-avatar')}<div class="skeleton-copy">${bar('skeleton-short')}${bar()}${bar('skeleton-medium skeleton-faint')}</div></div>`;
  const reader = () => `<div class="skeleton-reader">${bar('skeleton-title')}${bar('skeleton-title skeleton-medium')}${row()}<div class="skeleton-paragraph">${bar()}${bar()}${bar('skeleton-medium')}</div><div class="skeleton-paragraph">${bar()}${bar('skeleton-medium')}${bar('skeleton-short')}</div>${bar('skeleton-attachment')}</div>`;
  function markup(kind, label, mode = 'week') {
    let content;
    if (kind === 'mail') content = `<div class="skeleton-mail-list">${bar('skeleton-title skeleton-short')}<div class="skeleton-filters">${bar()}${bar()}${bar()}</div>${Array.from({ length: 6 }, row).join('')}</div><div class="skeleton-mail-reader">${reader()}</div>`;
    else if (kind === 'calendar') {
      const days = mode === 'day' ? 1 : mode === 'quarter' ? 3 : 7;
      content = `<div class="skeleton-calendar" style="--skeleton-days:${days}">${bar('skeleton-title skeleton-short')}<div class="skeleton-calendar-grid">${Array.from({ length: days }, () => `<div>${bar('skeleton-short')}${bar('skeleton-event')}${bar('skeleton-event skeleton-faint')}</div>`).join('')}</div></div>`;
    } else if (kind === 'contacts') content = `<div class="skeleton-contacts">${bar('skeleton-title skeleton-short')}${row()}${row()}<div class="skeleton-contact-grid">${Array.from({ length: 6 }, () => `<div>${row()}</div>`).join('')}</div></div>`;
    else if (kind === 'reader') content = reader();
    else throw new Error(`Unknown loading placeholder: ${kind}`);
    return `<div class="loading-placeholder loading-${kind}" role="status" aria-busy="true" aria-label="${escape(label)}"><span class="loading-caption">${escape(label)}</span><div class="skeleton-layout" aria-hidden="true">${content}</div></div>`;
  }
  const api = { markup };
  if (typeof module !== 'undefined') module.exports = api;
  else root.asterLoading = api;
})(typeof window === 'undefined' ? {} : window);
