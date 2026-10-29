# Материалы для продвижения Aster Mail

Это черновики для публикации автором. Тексты не означают, что продукт уже
размещён на перечисленных площадках или принят в каталоги.

## Позиционирование

Для пользователей корпоративного Exchange, которым нужно отдельное приложение
с почтой, календарём и коллегами. Поддерживаемые сборки: macOS Apple Silicon
и Windows x64. Прямое подключение к серверу, без промежуточного облака Aster
и телеметрии. Интерфейс пока на русском. Часть функций требует EWS;
SSO/MFA через отдельный домен и офлайн-база пока не поддерживаются.

Не обещать универсальную совместимость с Microsoft 365, поддержку всех версий
Exchange, английский интерфейс или функции, ещё не вошедшие в релиз.

## Короткое объявление

Развиваю Aster Mail — открытый клиент Exchange для macOS Apple Silicon
и Windows x64. В одном приложении — почта, календарь, коллеги; на Mac есть
виджет встреч в строке меню. Приложение подключается к вашему серверу напрямую,
без облака Aster и телеметрии.

Ищу пользователей Exchange для обратной связи о совместимости. Это ранняя
версия: часть операций требует EWS, интерфейс на русском, сборки без подписи
издателя. Сначала можно посмотреть демо с вымышленными данными.

[Проект и установка](https://github.com/darxfame/aster-mail) ·
[Отчёт о совместимости](https://github.com/darxfame/aster-mail/issues/new?template=compatibility_report.md)

## Show HN: черновик

Title: Show HN: Aster Mail – an open-source Exchange OWA/EWS desktop client

URL: https://github.com/darxfame/aster-mail

Comment draft:

I'm building Aster Mail, an MIT-licensed desktop client for corporate Exchange.
It combines mail, calendar, and contacts, with a meeting widget on macOS.
It connects directly to your server, with no Aster cloud or usage telemetry.

You can download macOS Apple Silicon and Windows x64 builds, or run the browser
demo with fictional data using the README instructions. The interface is
currently Russian. This is an early release: some operations require EWS,
separate-domain SSO/MFA and offline use are not supported, and builds are unsigned.

I'd appreciate feedback from people using Exchange, especially about setup
friction and compatibility. Documentation and accessibility contributions
are welcome too; there are small, scoped issues for first contributions.

Перед публикацией: автор должен быть готов лично обсуждать проект и отвечать
на вопросы. Не просить голосовать и не публиковать одинаковые анонсы каждого
небольшого релиза. [Правила Show HN](https://news.ycombinator.com/showhn.html).

## Статья для Хабра: план

Заголовок: «Aster Mail: делаю открытый клиент Exchange для macOS и Windows».

1. Личная причина разработки — автор добавляет собственный опыт без вымышленных историй.
2. Три сценария: разобрать почту, найти время встречи, открыть ближайший созвон.
3. Скриншоты с вымышленными данными и короткая демонстрация.
4. Прямое подключение, хранение пароля по выбору и ограничения ранней версии.
5. Установка и демо; конкретная просьба сообщить о совместимости.
6. Приглашение к небольшим PR по документации и доступности.

## Демонстрация на 45–60 секунд

- 0–10 с: открыть «Посмотреть демо», показать почту и папки.
- 10–25 с: открыть вымышленное письмо и поиск внутри текста.
- 25–40 с: переключиться на календарь и открыть встречу.
- 40–50 с: показать виджет встреч на macOS, если записывается настольное приложение.
- 50–60 с: ссылка на Releases и пояснение про Exchange/EWS и русский интерфейс.

Записывать только демо. Не показывать настоящий аккаунт, уведомления,
корпоративные домены, письма или встречи.

## Каталоги

Первый кандидат — [awesome-mac](https://github.com/jaywcjlove/awesome-mac),
категория почтовых клиентов. Перед подачей проверить актуальные правила
участия, отсутствие дубликата и требования к зрелости приложения.
Принятие зависит от редакторов каталога.

English entry draft:

> Aster Mail — Open-source Exchange OWA/EWS desktop client with mail, calendar,
> contacts, and a macOS meeting widget. Russian interface; some features require EWS.

## Пилот и оценка результата

Ориентир первого месяца: 10 добровольных участников с успешным подключением,
из них 5 подтвердили использование через неделю. Это целевые числа, не прогноз.
Собирать только добровольные обезличенные отзывы. Не добавлять телеметрию ради
показателей и не считать загрузки уникальными пользователями.

Раз в неделю смотреть: проблемы установки и входа, результаты совместимости,
повторное использование по добровольным ответам, внешние issues и PR.
Для участников важны небольшие задачи и содержательный ответ сопровождающего.

Публикация сайта с демо, запись видео, подпись установщиков и внешние анонсы —
отдельные действия; этот пакет документации их не выполняет.
