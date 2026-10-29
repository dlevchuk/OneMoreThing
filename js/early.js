'use strict';

// Виставляє клас до першого малювання, щоб не було спалаху перед матричним переходом.
// Окремий файл, бо inline-скрипти заборонені CSP.
if (new URLSearchParams(window.location.search).get('transition') === 'matrix') {
    document.documentElement.classList.add('matrix-arriving');
}