(function (root) {
  function normalize(value, allowHttp = false) {
    const url = new URL(value);
    if (!['https:', ...(allowHttp ? ['http:'] : [])].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['/', '/owa', '/owa/'].includes(url.pathname)) throw new Error('Укажите адрес сервера без логина и параметров, например mail.company.ru/owa/. HTTP требует явного выбора.');
    return url.origin;
  }
  function address(protocol, value) {
    if (!['https', 'http', 'custom'].includes(protocol)) throw new Error('Выберите протокол подключения');
    const input = String(value || '').trim();
    if (!input) throw new Error('Укажите адрес OWA-сервера');
    const full = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
    if (protocol === 'custom' && !full) throw new Error('В режиме полного URL укажите http:// или https://');
    const url = new URL(full ? input : `${protocol}://${input}`);
    if (protocol !== 'custom' && url.protocol !== `${protocol}:`) throw new Error('Протокол в адресе не совпадает с выбранным');
    const allowHttp = url.protocol === 'http:';
    return { server: normalize(url.href, allowHttp), allowHttp };
  }
  const api = { normalize, address };
  if (typeof module !== 'undefined') module.exports = api; else root.asterServer = api;
})(typeof window === 'undefined' ? {} : window);
