# Aster Mail

**[Скачать последнюю версию для macOS / Windows](https://github.com/darxfame/aster-mail/releases/latest)**

**Русский · [Read in English →](https://github.com/darxfame/aster-mail/blob/main/README.en.md)**

Открытый настольный клиент **Microsoft Exchange OWA/EWS** для
**macOS Apple Silicon и Windows x64**. Почта, календарь и коллеги в одном
приложении — с прямым подключением к вашему серверу, без промежуточного
облака Aster и телеметрии.

[![Релиз](https://img.shields.io/github/v/release/darxfame/aster-mail?style=flat&label=%D0%A0%D0%B5%D0%BB%D0%B8%D0%B7&labelColor=30263f&color=8b64cb)](https://github.com/darxfame/aster-mail/releases/latest)
[![Скачивания](https://img.shields.io/github/downloads/darxfame/aster-mail/total?style=flat&label=%D0%A1%D0%BA%D0%B0%D1%87%D0%B8%D0%B2%D0%B0%D0%BD%D0%B8%D1%8F&labelColor=30263f&color=8b64cb)](https://github.com/darxfame/aster-mail/releases)
[![Звёзды](https://img.shields.io/github/stars/darxfame/aster-mail?style=flat&label=%D0%97%D0%B2%D1%91%D0%B7%D0%B4%D1%8B&labelColor=30263f&color=8b64cb)](https://github.com/darxfame/aster-mail/stargazers)
[![Проверки](https://github.com/darxfame/aster-mail/actions/workflows/checks.yml/badge.svg)](https://github.com/darxfame/aster-mail/actions/workflows/checks.yml)

[Руководство](docs/USER-GUIDE.md) · [План развития](docs/OWA-TODO.md) ·
[Сообщить об ошибке](https://github.com/darxfame/aster-mail/issues/new/choose) ·
[Задачи для первого PR](https://github.com/darxfame/aster-mail/contribute)

[![Aster Mail — интерфейс с вымышленными данными](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-sidebar-cards-0.1.3.jpg)](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-sidebar-cards-0.1.3.jpg)

## Подойдёт ли вам Aster Mail

Приложение для тех, кто работает с корпоративной почтой Exchange через OWA
и хочет отдельное рабочее пространство с календарём и уведомлениями.
Совместимость зависит от конфигурации вашего сервера.

| Что проверить перед установкой | Поддержка |
| --- | --- |
| Компьютер | macOS на Apple Silicon или Windows x64 |
| Подключение | HTTPS-адрес OWA; корпоративный VPN, если он требуется |
| Полный набор функций | Отправка, редактирование черновиков и часть операций календаря и контактов требуют EWS |
| Авторизация | SSO/MFA через отдельный домен пока не поддерживается |
| Работа без сети | Офлайн-базы пока нет |
| Язык интерфейса | Русский |

Есть демо с вымышленными данными: интерфейс можно оценить без подключения
корпоративной почты. [Запуск браузерного демо](#демо-без-exchange).

## Почему Aster Mail

- **Почта под рукой.** Папки, поиск, ответы и пересылка, форматирование,
  серверные черновики и открытие вложений в системном приложении.
- **Удобнее планировать.** Календарь дня и недели, приглашения, занятость коллег
  и подбор общего времени. На macOS — виджет встречи в строке меню.
- **Меньше отвлечений.** Светлая и тёмная темы, настраиваемые уведомления,
  компактный индикатор связи и автоматическое восстановление подключения OWA.
- **Прямой доступ к Exchange.** Без промежуточного облака Aster и телеметрии.
  Открытый исходный код под MIT.

В разрабатываемой версии 0.1.23: отдельные «Кому»/«Копия», карточки получателей
и общий поиск писем, событий основного календаря и личных контактов.
Доступность в установщике проверяйте по описанию последнего релиза.

### Календарь и встречи

[![Календарь Aster Mail с вымышленными данными](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-calendar-0.1.5.jpg)](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-calendar-0.1.5.jpg)

[![Виджет встреч Aster Mail для macOS](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-widget-grid-0.1.7.jpg)](https://raw.githubusercontent.com/darxfame/aster-mail/main/docs/aster-widget-grid-0.1.7.jpg)

## Безопасность в основе разработки

- **Защищённое подключение.** Только HTTPS с проверкой TLS; учётные данные
  передаются только вашему серверу Exchange.
- **Контроль локальных данных.** Сохранение пароля — по выбору пользователя,
  через системное защищённое хранилище Electron `safeStorage`. Почтовый кэш
  находится в памяти; открываемые вложения используют временные копии
  с ограничениями по размеру, количеству и сроку хранения.
- **Изолированное содержимое.** HTML очищается и открывается без скриптов
  в sandbox. Сторонние изображения блокируются; разрешённые загружаются
  без cookies и пароля. Предпросмотр текста уведомлений включается явно.
- **Осторожное изменение почты.** Отправка и другие операции записи
  не повторяются автоматически при неопределённом результате.
- **Проверяемые изменения.** Проверки синтаксиса и автотесты на macOS и Windows
  в GitHub Actions; тесты протокола используют вымышленные данные.
  Обновления проверяются по размеру и SHA-256 перед открытием установщика.

Меры защиты и порядок сообщения об уязвимостях — в [SECURITY.md](SECURITY.md).
Проект развивается: независимый аудит безопасности и универсальная совместимость
со всеми конфигурациями Exchange не заявляются.

## Установка и совместимость

Скачайте **DMG для macOS Apple Silicon** или **EXE для Windows x64**
из [GitHub Releases](https://github.com/darxfame/aster-mail/releases/latest).
На Mac перенесите Aster Mail в «Программы», на Windows запустите установщик.
Перед обновлением полностью завершите приложение. Сборки пока без подписи издателя;
системные предупреждения при установке возможны.

Подключитесь к своему HTTPS-адресу OWA; если нужен корпоративный VPN,
включите его заранее. Доступ к OWA не гарантирует доступность всех функций:
**отправка, редактирование черновиков и часть операций календаря и контактов
пока требуют EWS**. Перенос возможностей на OWA — в [плане развития](docs/OWA-TODO.md).

Ранняя версия: один аккаунт, без офлайн-базы, общих ящиков и PGP/S/MIME.
SSO/MFA через отдельный домен пока не поддерживается. Перед работой с основной
почтой проверьте нужные сценарии на тестовом аккаунте Exchange.
[Подробные ограничения](docs/USER-GUIDE.md#ограничения-01).

## Разработка и участие

Для запуска из исходников нужны Node.js 22+ и npm:

```sh
git clone https://github.com/darxfame/aster-mail.git
cd aster-mail
npm ci
npm start
```

### Демо без Exchange

После установки зависимостей выполните:

```sh
npm run preview
```

Откройте [localhost:4173](http://localhost:4173) и выберите деморежим.
Браузерный просмотр предназначен только для демо; подключение к Exchange
работает в настольном приложении. Демо не подтверждает совместимость с вашим сервером.

### Как помочь проекту

- **Пользователям:** сообщайте об ошибках с версией приложения, ОС и шагами
  воспроизведения. Не публикуйте корпоративную переписку и учётные данные.
- **Разработчикам:** приветствуются исправления, улучшения доступности,
  документация и тесты с вымышленными данными. Перед большой доработкой
  обсудите задачу в [issue](https://github.com/darxfame/aster-mail/issues).
- **Если приложение полезно:** поставьте звезду и поделитесь ссылкой
  с коллегами, которым нужен клиент Exchange.

Issues и pull requests можно писать на русском или английском.
[Задачи для первого PR](https://github.com/darxfame/aster-mail/contribute) ·
[Нужна помощь](https://github.com/darxfame/aster-mail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22help%20wanted%22) ·
[Сообщить о совместимости](https://github.com/darxfame/aster-mail/issues/new?template=compatibility_report.md).

[Разработка и проверки](CONTRIBUTING.md) · [Сборка Windows](docs/WINDOWS.md) ·
[Архитектура и соглашения](AGENTS.md).

Лицензия — [MIT](LICENSE), оригинальные звуки — [CC0](assets/sounds/LICENSE.md).
Атрибуция адаптированного кода — [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<sub>Скачивания — загрузки файлов релизов, а не уникальные или активные пользователи.
Статистика использования приложения не собирается.</sub>
