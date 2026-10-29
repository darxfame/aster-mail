// Explicitly fictional data. Never mixed with a connected mailbox.
window.asterDemo = (() => {
  const at = (days, hours, minutes = 0) => { const date = new Date(); date.setDate(date.getDate() + days); date.setHours(hours, minutes, 0, 0); return date.toISOString(); };
  const person = (name, email) => ({ name, email });
  const messages = [
    { id: 'demo-1', subject: 'Новый взгляд на привычные вещи', from: person('Анна Смирнова', 'anna@example.com'), date: at(0, 10, 42), read: false, flagged: true, preview: 'Собрала мысли по новому направлению. Кажется, мы нашли тот самый баланс.', html: '<p>Привет!</p><p>Собрала мысли по новому направлению. Кажется, мы нашли тот самый баланс между простотой и возможностями.</p><p>Хочется, чтобы рабочие инструменты оставляли больше пространства для самого важного. Меньше визуального шума, больше внимания к деталям.</p><h3>Что предлагаю обсудить</h3><ul><li>Единую структуру для почты, встреч и контактов</li><li>Спокойные цвета и понятную навигацию</li><li>Маленькие детали, которые делают день проще</li></ul><p>Первые наброски — во вложении. Посмотри, когда будет свободная минутка, и давай обсудим на встрече завтра.</p><p>Хорошего дня!<br>Анна</p>', attachments: [{ id: 'demo-attachment', name: 'Направление проекта.txt', size: 1850 }], hasAttachments: true, folder: 'inbox' },
    { id: 'demo-2', subject: 'Приглашение: обсуждение проекта', from: person('Михаил Волков', 'mikhail@example.com'), date: at(0, 10, 15), read: false, preview: 'Завтра, 11:00–11:45 · Обсудим идеи и договоримся о следующих шагах.', text: 'Приглашаю обсудить новый проект и следующие шаги. Повестка: идеи, приоритеты, сроки.', meeting: { id: 'demo-event-1', start: at(1, 11), end: at(1, 11, 45), location: 'Переговорная «Кедр»' }, folder: 'inbox' },
    { id: 'demo-3', subject: 'Материалы к следующей встрече', from: person('Елена Козлова', 'elena@example.com'), date: at(0, 9, 48), read: true, preview: 'Все материалы собраны в одном месте. Добавила комментарии и открытые вопросы.', hasAttachments: true, text: 'Доброе утро!\n\nВсе материалы собраны в одном месте. Добавила комментарии и открытые вопросы.\n\nБуду рада вашим замечаниям.\nЕлена', folder: 'inbox' },
    { id: 'demo-4', subject: 'Планы на неделю', from: person('Дмитрий Соколов', 'dmitry@example.com'), date: at(0, 9, 20), read: true, preview: 'Коллеги, доброе утро! Коротко о приоритетах на эту неделю и важных датах.', text: 'Коллеги, доброе утро!\n\nНа этой неделе фокусируемся на первой версии и обратной связи. В пятницу подведём итоги.\n\nСпасибо!\nДмитрий', folder: 'inbox' },
    { id: 'demo-5', subject: 'Re: Обратная связь по прототипу', from: person('Алексей Морозов', 'alex@example.com'), date: at(-1, 17, 35), read: true, flagged: true, preview: 'Спасибо за обновление! Новая навигация стала заметно понятнее.', text: 'Спасибо за обновление! Новая навигация стала заметно понятнее.\n\nПредлагаю сохранить это направление и проверить его на остальных экранах.', folder: 'inbox' },
    { id: 'demo-6', subject: 'Итоги встречи и следующие шаги', from: person('Анна Смирнова', 'anna@example.com'), date: at(-1, 15, 10), read: true, preview: 'Зафиксировала договорённости. Начнём с самого важного, остальное добавим по мере необходимости.', text: 'Зафиксировала договорённости.\n\n1. Проверяем подключение.\n2. Дорабатываем почту.\n3. Собираем обратную связь.\n\nАнна', folder: 'inbox' },
    { id: 'demo-7', subject: 'Доступ к рабочим инструментам', from: person('Команда поддержки', 'support@example.com'), date: at(-1, 12), read: true, preview: 'Добро пожаловать! Всё, что нужно для комфортного начала работы.', text: 'Добро пожаловать!\n\nПо вопросам подключения обратитесь к вашему администратору Exchange.', folder: 'inbox' },
  ].map(m => ({ ...m, to: [person('Вы', 'you@example.com')], cc: [], attachments: m.attachments || [] }));
  messages[2].cc = [person('Вы', 'YOU@example.com'), person('Анна Смирнова', 'anna@example.com')];
  messages[2].text += '\n\n—— Предыдущая переписка ——\nОт: Вы <you@example.com>\nКому: Елена Козлова <elena@example.com>\nТема: Материалы к следующей встрече\n\nЕлена, пришлите, пожалуйста, материалы к обсуждению. Спасибо!';
  messages[2].attachments = ['План проекта.pdf', 'Макет интерфейса.png', 'Смета.xlsx', 'Заметки.docx', 'Материалы.zip', 'Описание.txt'].map((name, i) => ({ id: `demo-material-${i}`, name, size: 1024 * (i + 1) }));
  messages[0].html += '<table bgcolor="#ffffff"><tr><td><img src="cid:demo-logo" alt="Логотип Aster" width="80" height="80"><p><a href="https://example.com/project">Открыть материалы проекта</a> — ссылка остаётся в тексте письма.</p></td></tr></table>';
  const events = [
    { id: 'demo-event-1', title: 'Обсуждение проекта', start: at(1, 11), end: at(1, 11, 45), location: 'Переговорная «Кедр»', preview: 'Идеи, приоритеты и следующие шаги', organizer: person('Михаил Волков', 'mikhail@example.com') },
    { id: 'demo-event-2', title: 'Командная встреча', start: at(0, 10), end: at(0, 10, 30), location: 'Онлайн', preview: 'Сверим планы на сегодня', organizer: person('Анна Смирнова', 'anna@example.com') },
    { id: 'demo-event-3', title: 'Обзор дизайна', start: at(0, 14), end: at(0, 15), location: 'Дизайн-студия', preview: 'Обратная связь по новой версии', organizer: person('Елена Козлова', 'elena@example.com') },
    { id: 'demo-event-4', title: 'Время для фокуса', start: at(2, 9), end: at(2, 11), location: '', preview: 'Без встреч и отвлечений', organizer: person('Вы', 'you@example.com') },
    { id: 'demo-event-5', title: 'Итоги недели', start: at(2, 16), end: at(2, 16, 45), location: 'Переговорная «Сосна»', preview: 'Что получилось и что можно улучшить', organizer: person('Дмитрий Соколов', 'dmitry@example.com') },
  ];
  events.push(
    { id: 'demo-overlap-1', title: 'Техническое обсуждение', start: at(0, 10, 15), end: at(0, 11), location: 'Онлайн' },
    { id: 'demo-overlap-2', title: 'Проверка макетов', start: at(0, 10, 20), end: at(0, 10, 50), location: 'Дизайн' },
  );
  const contacts = [
    { id: 'c1', name: 'Анна Смирнова', email: 'anna@example.com', company: 'Продуктовая команда', phone: '+7 000 000-00-01' },
    { id: 'c2', name: 'Михаил Волков', email: 'mikhail@example.com', company: 'Разработка', phone: '+7 000 000-00-02' },
    { id: 'c3', name: 'Елена Козлова', email: 'elena@example.com', company: 'Дизайн', phone: '' },
    { id: 'c4', name: 'Дмитрий Соколов', email: 'dmitry@example.com', company: 'Продуктовая команда', phone: '' },
    { id: 'c5', name: 'Алексей Морозов', email: 'alex@example.com', company: 'Разработка', phone: '' },
    { id: 'c6', name: 'Команда поддержки', email: 'support@example.com', company: 'IT', phone: '' },
  ];
  events.forEach((event, i) => {
    Object.assign(event, { changeKey: 'demo-version', response: i === 0 ? 'Unknown' : i === 1 ? 'Accept' : i === 2 || i === 3 ? 'Organizer' : i === 4 ? 'Decline' : 'Tentative', isOrganizer: i === 2 || i === 3, reminder: 15, reminderSet: true, showAs: 'Busy', sensitivity: 'Normal', attendees: contacts.slice(0, 4).map((c, n) => ({ ...c, role: n === 3 ? 'optional' : 'required', response: n === 0 ? 'Accept' : n === 1 ? 'Tentative' : 'Unknown' })), attachments: [] });
    if (event.isOrganizer) event.organizer = person('Вы', 'you@example.com');
  });
  for (const event of [events[0], events[2]]) {
    event.recurring = true; event.calendarType = 'Occurrence'; event.seriesId = `series-${event.id}`;
    event.location = 'https://calls.example.com/aster-project'; event.joinUrl = event.location;
    event.html = '<p>Коллеги, привет!</p><p>Обсудим <strong>следующие шаги проекта</strong>, сроки и ответственных.</p><ul><li>Текущий статус</li><li>Вопросы команды</li><li>План на неделю</li></ul><p><a href="https://example.com/project">Материалы проекта</a></p>';
    event.attachments = [{ id: 'demo-image', name: 'Aster — иллюстрация.png', type: 'image/png', size: 21952, contentId: 'demo-aster', previewUrl: '../assets/icon.png' }, { id: 'demo-document', name: 'Повестка встречи.txt', type: 'text/plain', size: 2048 }];
    const next = structuredClone(event); next.id += '-next'; next.start = new Date(Date.parse(event.start) + 7 * 86400000).toISOString(); next.end = new Date(Date.parse(event.end) + 7 * 86400000).toISOString(); events.push(next);
  }
  const folders = [
    ...[['inbox', 'Входящие'], ['sentitems', 'Отправленные'], ['drafts', 'Черновики'], ['archive', 'Архив'], ['deleteditems', 'Корзина'], ['junkemail', 'Нежелательная почта']].map(([wellKnown, name]) => ({ id: `folder-${wellKnown}`, wellKnown, name, parentId: 'mail-root', unread: 0 })),
    { id: 'demo-projects', name: 'Проекты', parentId: 'folder-inbox', unread: 2 },
    { id: 'demo-design', name: 'Дизайн', parentId: 'demo-projects', unread: 1 },
    { id: 'demo-team', name: 'Команда', parentId: 'folder-inbox', unread: 0 },
    { id: 'demo-docs', name: 'Документы', parentId: 'mail-root', unread: 0 },
  ];
  return { messages, events, contacts, folders, directory: [...contacts, { id: 'directory-irina', name: 'Ирина Новикова', email: 'irina.novikova@example.com', company: 'Команда исследований', source: 'directory' }, { id: 'directory-pavel', name: 'Павел Орлов', email: 'pavel.orlov@example.com', company: 'Команда разработки', source: 'directory' }] };
})();
