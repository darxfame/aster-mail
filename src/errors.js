(function (root) {
  const tr = typeof module !== 'undefined' ? require('./i18n.js').text : root.asterI18n.text;
  function message(error, { operation = error?.operation || '', debug = false } = {}) {
    const raw = String(error?.message || error || '');
    if (error?.userFacing) return debug ? raw : raw.split(/\n(?:Технические сведения:|Technical details:)/)[0];
    const status = Number(error?.status || /\bHTTP\s+(\d{3})\b/.exec(raw)?.[1]);
    const code = /^Error[A-Za-z0-9]+$/.test(error?.code || '') ? error.code : /\bError[A-Z][A-Za-z0-9]+\b/.exec(raw)?.[0];
    const transport = /\bERR_[A-Z_]+\b/.exec(String(error?.code || '') + ' ' + raw)?.[0];
    const native = /^(?:TypeError|ReferenceError|SyntaxError|RangeError)$/.test(error?.name || '') || /\b(?:is not a function|is not defined|Cannot read|Cannot set|Unexpected token)\b/.test(raw);
    const technical = status || code || native || transport || /^(?:OWA |EWS |Exchange:|Invalid |ENOENT|EACCES|EPERM)|\b(?:ChangeKey|CANARY)\b/.test(raw);
    if (!technical) return raw;
    let text;
    if (code === 'ErrorItemNotFound') text = operation === 'message' ? tr('Письмо не найдено на сервере. Обновите список писем.') : tr('Объект не найден на сервере. Обновите список и откройте его заново.');
    else if ([401, 440, 449].includes(status) || ['ErrorInvalidClientAccessToken', 'ErrorInvalidUserSid'].includes(code)) text = tr('Сервер отклонил авторизацию. Подключите аккаунт заново.');
    else if (status === 403 || code === 'ErrorAccessDenied') text = tr('Сервер запретил доступ к этой операции. Проверьте права доступа у администратора.');
    else if (status === 501 || code === 'ErrorInvalidOperation' || code === 'ErrorNotImplemented') text = tr('Сервер не поддерживает эту операцию. Обратитесь к администратору.');
    else if (native) text = tr('В приложении произошла ошибка. Если она повторяется, перезапустите Aster.');
    else if (/^Invalid /.test(raw)) text = tr('Запрос приложения некорректен. Закройте это окно и откройте его заново.');
    else if (transport) text = tr('Не удалось связаться с сервером. Проверьте подключение, VPN и доверие сертификату.');
    else if (['connect', 'restore'].includes(operation)) text = tr('Не удалось подключить аккаунт. Проверьте адрес сервера и способ входа.');
    else if (operation === 'message') text = tr('Не удалось открыть письмо: сервер вернул ошибку при загрузке.');
    else if (['event', 'eventDetails'].includes(operation)) text = tr('Не удалось открыть встречу: сервер вернул ошибку при загрузке.');
    else if (operation === 'contacts') text = tr('Не удалось получить адреса из справочника: сервер вернул ошибку.');
    else if (/\b(?:ENOENT|EACCES|EPERM)\b/.test(raw)) text = tr('Не удалось получить доступ к локальному файлу. Проверьте права и доступность папки.');
    else text = tr('Не удалось выполнить действие: сервер вернул ошибку.');
    // Retain write uncertainty even when a protocol error is replaced by plain language.
    const writing = ['send', 'draft', 'editDraft', 'move', 'change', 'mailBatch', 'folderOperation', 'createMailRule', 'createEvent', 'updateEvent', 'respond', 'eventMessage'].includes(operation);
    if (/неизвестен|не повторялась|перед повтор|unknown|not retried|before retry/i.test(raw) || writing && (native || status >= 500 || !status && !code && !/^Invalid /.test(raw))) {
      text += ` ${tr('Результат операции может быть неизвестен. Проверьте OWA перед повтором.')}`;
    }
    if (debug) {
      // Only structured codes and native error identifiers, never response bodies,
      // URLs, filesystem paths, credentials or exception values from mail content.
      const protocol = /\b(?:OWA|EWS)\s+[A-Za-z][A-Za-z0-9]{0,63}/.exec(raw)?.[0];
      const identifier = /\b[A-Za-z_$][\w$]{0,63} is not (?:a function|defined)\b/.exec(raw)?.[0];
      const detail = [protocol, status ? `HTTP ${status}` : '', code, transport, identifier || (native ? error?.name || 'JavaScript error' : '')].filter(Boolean).join(': ');
      if (detail) text += `\n${tr('Технические сведения:')} ${detail}`;
    }
    return text;
  }
  if (typeof module !== 'undefined') module.exports = { message }; else root.asterErrors = { message };
})(typeof window === 'undefined' ? {} : window);
