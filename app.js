import { ITDClient } from 'itd-sdk-js';
import express from 'express';
import fs from 'fs';
import postgres from 'postgres';

// Создаём .cookies из переменной окружения (как раньше)
if (process.env.ITD_REFRESH_TOKEN && !fs.existsSync('./.cookies')) {
  fs.writeFileSync('./.cookies', `refresh_token=${process.env.ITD_REFRESH_TOKEN}`);
}

const app = express();
app.use(express.json());
app.use(express.static('.'));

// Подключение к Supabase
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

// Создаём таблицу при старте (если её нет)
async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_users (
      username TEXT PRIMARY KEY
    )
  `;
  console.log('✅ База данных готова');
}

const client = new ITDClient();

// Добавить username
app.post('/add', async (req, res) => {
  const { username } = req.body;
  if (!username) {
    return res.status(400).json({ error: 'username пуст' });
  }
  try {
    await sql`INSERT INTO tracked_users (username) VALUES (${username}) ON CONFLICT DO NOTHING`;
    const [{ count }] = await sql`SELECT COUNT(*)::int FROM tracked_users`;
    res.json({ ok: true, count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Топ-100
app.get('/top100', async (req, res) => {
  const results = [];
  try {
    const rows = await sql`SELECT username FROM tracked_users`;
    for (const row of rows) {
      const username = row.username;
      try {
        const user = await client.getUserProfile(username);
        let clanEmoji = null;
        try {
          const clan = await client.getUserClan(username);
          clanEmoji = typeof clan === 'string' ? clan : (clan?.emoji || null);
        } catch (e) { /* игнорируем */ }

        results.push({
          username: user.username,
          displayName: user.displayName,
          followers: user.followersCount || 0,
          following: user.followingCount || 0,
          posts: user.postsCount || 0,
          verified: user.verified || false,
          clanEmoji: clanEmoji
        });
      } catch (e) {
        console.warn(`Не удалось получить ${username}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 300));
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Ошибка базы данных' });
  }

  results.sort((a, b) => b.followers - a.followers);
  res.json(results.slice(0, 100));
});

// Запуск: сначала база, потом сервер
initDb().then(() => {
  app.listen(3000, () => console.log('Сервер запущен: http://localhost:3000'));
}).catch(e => {
  console.error('Ошибка инициализации базы:', e);
  process.exit(1);
});