// Настройки сайта. apiUrl — адрес бэкенда на Cloudflare (worker/worker.js), он хранит ключ OpenAI в секрете.
// Если строку сделать пустой, генерация переключится в демо-режим.
window.MAESTRO_CONFIG = {
  apiUrl: 'https://maestro-api.maestro-art.workers.dev',
};
