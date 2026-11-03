# Разработка и внедрение модулей

Контракт API 1 описан в [architecture.md](architecture.md); схема — [module.schema.json](module.schema.json). Рабочий пример — `examples/modules/sandbox-demo`. Он демонстрирует собственную логику, кнопки, внутренние команды, встраиваемую панель, зашифрованное состояние и события. Внешние сервисы не вызываются.

## Состав пакета

```text
module.json
main.js
panel.html
panel.js
panel.css
```

`files` перечисляет точные относительные пути всех ресурсов, кроме автоматически включаемого `module.json`. Список используется одинаково при установке из папки и GitHub; остальные файлы репозитория не загружаются и не исполняются. Включайте необходимые LICENSE/NOTICE.

`main.js` — браузерный ES module. Не CommonJS и не Node.js. Сборщик проекта модуля может собрать браузерные зависимости в локальные JS/CSS-файлы; сам Aster сборщик не требует. Не используйте удалённые CDN, inline script, inline event handlers, `eval`, workers, iframe или нативные зависимости.

`module.json`:

```json
{
  "apiVersion": 1,
  "id": "company.meetings",
  "version": "1.0.0",
  "type": "hybrid",
  "name": "Company meetings",
  "main": "main.js",
  "files": ["main.js", "panel.html", "panel.js", "panel.css"],
  "permissions": ["ui", "storage", "network", "meeting.draft"],
  "networkOrigins": ["https://meetings.example.com"],
  "networkHeaders": ["x-api-key"],
  "commands": [
    { "id": "create", "title": "Create meeting link", "slot": "meeting.create" },
    { "id": "configure", "title": "Configure", "slot": "internal" }
  ],
  "views": [
    { "id": "settings", "title": "Company meetings settings", "file": "panel.html", "slot": "panel", "height": 240 }
  ]
}
```

Адрес выше вымышленный. Это пример контракта, не реализация ktalk.ru. Нельзя добавлять ключи/пароли в пакет. Origin должен быть HTTPS без пути, query, userinfo и fragment; без wildcard. Имена `x-*` заголовков авторизации объявляются заранее. Cookie/Host/Origin/Referer и перенос учётных данных Exchange запрещены.

JSON Schema помогает редактору, а `node scripts/check-module.cjs <folder>` выполняет авторитетную проверку host, проверяет пути/ресурсы и рассчитывает digest без выполнения кода. Команды и представления имеют уникальные ID внутри пакета. Неизвестные поля, типы, разрешения и версии API отклоняются.

## API логики

```js
export async function activate(api) {
  const unsubscribe = api.onEvent(event => {
    // React only to the documented topics needed by this module.
  });
  return {
    commands: {
      async create(input, context) {
        const draft = await api.call('meeting.getDraft');
        // Validate the snapshot and obtain explicit user intent before remote writes.
        // Use the module's own view for service-specific forms.
        return { ready: Boolean(draft.start && draft.end) };
      },
      async configure() {
        return api.call('ui.openView', { view: 'settings' });
      }
    }
  };
}
```

`activate` вызывается один раз на экземпляр. Храните текущее состояние в памяти; необходимые настройки сохраняйте по мере изменения через `storage.set`. На остановку нельзя рассчитывать как на гарантированный callback: процесс может завершиться аварийно. Отключение от событий (`unsubscribe`) используйте при пересоздании подписок. Не рассчитывайте на `beforeunload` и не задерживайте остановку модуля: важные изменения собственной формы сохраняйте по мере ввода в зашифрованное состояние host. Все побочные эффекты `activate` ограничивайте и не создавайте внешние объекты автоматически.

Команды возвращают JSON-значение или `undefined`. Одновременно выполняется одна команда на экземпляр. Обрабатывайте ошибки сами; необработанная ошибка возвращается в Aster как ошибка модуля. Автоматического повтора нет. Ошибки SDK имеют `code`: `permission-denied`, `rate-limit`, `network-unknown`, `http-error` или `module-request-rejected`. Для HTTP возвращается безопасный `status`, без тела ошибки сервиса и без stack host. HTTP 500 и неопределённый сетевой результат нельзя считать доказательством, что внешняя запись не произошла.

| `api.call(method, input)` | Право | Контракт |
| --- | --- | --- |
| `ui.context`, `{}` | `ui` | Язык, тема, IANA timezone и масштаб интерфейса; без данных аккаунта |
| `ui.openView`, `{view}` | `ui` | Только объявленное представление своего пакета, во время пользовательской команды |
| `storage.get`, `{}` | `storage` | JSON-состояние ТОЛЬКО своего модуля и текущего аккаунта |
| `storage.set`, `value` | `storage` | Заменить всё своё JSON-состояние, до 16 КБ. Зашифрованное хранение host |
| `network.request`, `{url, method?, body?, bearer?, headers?}` | `network` | HTTPS origin из manifest, методы GET/POST/PUT/PATCH/DELETE; JSON-ответ до 64 КиБ. Custom headers только объявленные `x-*`; optional Bearer задаёт Authorization |
| `calendar.list`, `{start,end}` | `calendar.read` | UTC instants, основной календарь, до 31 дня, ответ `{items,truncated,complete:false}`; до 200 элементов `{id,title,start,end,allDay}`. Полнота не подтверждается этим API |
| `meeting.getDraft`, `{}` | `meeting.draft` | Snapshot открытой новой встречи в контексте команды. `{title,location,body,timeZone,start,end,truncated}`; UTC или `null` при неполном вводе |
| `meeting.openDraft`, `patch` | `meeting.draft` | Открыть новую встречу с предложенными полями; только во время команды |
| `meeting.patchDraft`, `patch` | `meeting.draft` | Предложить изменения актуальному editorId из контекста. Не редактирует сохранённые события |
| `events.publish`, `{topic,data}` | `events` | Host добавит `<module-id>.` к теме; только JSON |

`patch` допускает только `title`, `location`, `body`, `start`, `end`. Время — UTC ISO c `Z`; host переводит его в выбранный пояс. Адреса участников и отправка приглашений недоступны. Замена уже заполненных полей требует подтверждения пользователя в UI. Черновик может измениться после snapshot: модуль должен считать snapshot подсказкой, а пользователь проверяет итог перед отдельным нажатием отправки.

Сетевой посредник не использует accountSession, не отвечает на NTLM/proxy challenges, не следует redirect, не принимает cookies и не повторяет операции. При тайм-ауте, отмене или непонятном ответе результат может быть неизвестен: нельзя автоматически создавать вторую комнату. Сохраняйте полученный идентификатор сервиса и позволяйте пользователю проверить первый результат. Внешний объект может остаться созданным после закрытия редактора — это не означает, что можно отправить приглашение или удалять объект без отдельного разрешения.

Для API-ключа сделайте собственное поле `type="password"`, передавайте его только в `storage.set`, не возвращайте его в результаты команд и не выводите в console/UI. При отзыве ключа пользователь должен иметь возможность очистить своё состояние. Разрешение network вместе с другими разрешениями даёт возможность отправить доступные модулю данные объявленному сервису; используйте минимальный набор прав.

## API представления

HTML загружает свои стили и JavaScript относительными URL:

```html
<link rel="stylesheet" href="panel.css">
<button id="save">Save</button>
<output id="status" aria-live="polite"></output>
<script src="panel.js"></script>
```

В JS доступен только узкий мост:

```js
const value = await window.asterModule.command('configure', { example: true });
const settings = await window.asterModule.call('storage.get');
const unsubscribe = window.asterModule.onEvent(event => {
  document.querySelector('#status').textContent = event.topic;
});
```

Команды объявляются в manifest, включая `slot: "internal"`. Для операций над черновиком и открытия панелей вызывайте команду: она задаёт ограниченный контекст пользовательского действия. Прямой SDK-вызов из UI не создаёт такой контекст. Доступ к `window.aster`, DOM основного приложения, Electron, Node, файлам, cookies Exchange и произвольной сети отсутствует.

Собственные настройки и рабочие панели могут быть несколькими `views`. Для внедрения части в форму новой встречи укажите `slot: "meeting.create"`. Host управляет clipping и масштабом; не делайте окна фиксированного desktop-размера, используйте адаптивные CSS, доступные подписи, клавиатуру и явное состояние ошибок. Не маскируйтесь под системные подтверждения Aster.

## Правила внедрения

1. Зафиксировать сценарий, данные, внешние записи и их неопределённые результаты. Проверить, что существующий SDK покрывает сценарий; не менять основные алгоритмы Exchange ради одного сервиса.
2. Определить минимальные разрешения и точные origins/headers. Сначала согласовать изменение API host, если текущего контракта недостаточно.
3. Разработать пакет отдельно; проверить лицензии зависимостей, отсутствие секретов и удалённых CDN.
4. Проверить `check-module.cjs`, подготовить fingerprint и release notes пакета. При изменении ресурсов повышать версию; не подменять опубликованный пакет.
5. В отдельном тестовом аккаунте установить пакет, выдать разрешения и проверить формы/команды без реальной отправки писем.
6. Проверить HTTP 401/403/429/500, redirect, timeout, обрыв после внешней записи, ошибку JSON, отзыв токена и отмену пользовательского действия. Повторов записи быть не должно.
7. Проверить чужой аккаунт, stale editorId, отключение/выход во время запроса, изменение файлов, неправильный manifest, невыданные разрешения и крупные IPC-сообщения.
8. Проверить адаптивность 100/150/200%, клавиатуру, прокрутку/clipping, несколько панелей и восстановление собственного состояния после закрытия панели. Повторно проверить обычное подключение, календарь и редакторы без модулей.
9. Выполнить `npm run check`, `npm test`, `npm run test:connection`, `npm run test:modules`. Изменения в коде host требуют независимого review и приёмки Windows/macOS до production.
10. Развёртывать без включения по умолчанию. Обновление — явное удаление/подключение новой версии и повторная выдача прав. При rollback отключить пакет, сохранить/экспортировать нужные собственные настройки безопасным способом и вернуть известный digest. Скрытых автоматических обновлений/миграций в API 1 нет.

## Границы первой версии

Нет магазина, доверенных подписей издателей, Node.js, нативных расширений, workers, произвольных iframe, WebRTC, общих account cookies, доступа к почте, фоновой отправки или изменения сохранённых встреч. OAuth/SSO окна, бинарные сетевые ответы, webhooks и новые extension points требуют отдельного контракта и проверки. Это ограничения host API, а не обещание автоматически поддержать любой внешний сервис.

## Модули автора и предложения сообщества

[Aster Mail Modules](https://github.com/darxfame/aster-mail-modules) — источник
модулей от автора Aster Mail и репозиторий для предложений собственных модулей.
Идею можно предложить в Issues, готовый пакет — через Pull Request. При подготовке
пакета соблюдайте контракт API 1 и правила внедрения выше; приложите описание
сценария, разрешений, внешних сервисов, лицензии и инструкцию проверки. Размещение
в этом репозитории не заменяет подтверждение установки и разрешений в Aster.

## Подключение непосредственно с GitHub

В «Настройки → Модули → Подключить с GitHub» укажите URL публичного репозитория, необязательный ref (ветка/тег/полный SHA) и относительную папку пакета. Например, учебный пакет Aster расположен в `examples/modules/sandbox-demo` ветки `codex/modules`.

Host разрешает ref в один полный commit SHA, затем загружает `module.json` и только перечисленные `files` через immutable raw URLs этого SHA. Суммарный предел — 10 МиБ; redirects, Git credentials, установочные hooks, npm install, сборка и git submodules не запускаются. Source repo, commit, directory и digest сохраняются как provenance вне манифеста и показываются перед установкой. Время загрузки ограничено двумя минутами, запросы отменяются при смене аккаунта. Файлы не выполняются до отдельного включения пакета и выдачи разрешений.

Прямое подключение не означает совместимость любого GitHub-проекта с Aster: репозиторий должен содержать module.json API 1 и готовые браузерные ресурсы. Private repos и GitHub Enterprise пока не поддерживаются; передача пароля Exchange, cookies или автоматическое использование Git credentials запрещены.
