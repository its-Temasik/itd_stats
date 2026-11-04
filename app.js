import { ITDClient } from 'itd-sdk-js';
import express from 'express';
import fs from 'fs';
import postgres from 'postgres';

if (process.env.ITD_REFRESH_TOKEN && !fs.existsSync('./.cookies')) {
  fs.writeFileSync('./.cookies', `refresh_token=${process.env.ITD_REFRESH_TOKEN}`);
}

const app = express();
app.use(express.json());
app.use(express.static('.'));

const sql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  family: 4
});

async function initDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS tracked_users (
      username TEXT PRIMARY KEY
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS user_stats (
      username TEXT PRIMARY KEY,
      display_name TEXT,
      followers INT,
      following INT,
      posts INT,
      verified BOOLEAN,
      clan_emoji TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ База данных готова');
}

const client = new ITDClient({
  userAgent: process.env.ITD_USER_AGENT
});

// Добавить username
app.post('/add', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'username пуст' });

  try {
    const existing = await sql`SELECT 1 FROM tracked_users WHERE username = ${username}`;
    if (existing.length > 0) {
      return res.status(409).json({ error: 'Этот username уже отслеживается' });
    }

    await sql`INSERT INTO tracked_users (username) VALUES (${username})`;
    const [{ count }] = await sql`SELECT COUNT(*)::int FROM tracked_users`;
    res.json({ ok: true, count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Топ-100 — только из базы, без API
app.get('/top100', async (req, res) => {
  const rows = await sql`
    SELECT username, display_name AS "displayName", followers, following, posts, verified, clan_emoji AS "clanEmoji"
    FROM user_stats
    ORDER BY followers DESC
    LIMIT 100
  `;
  res.json(rows);
});

app.get('/user/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const rows = await sql`
      SELECT username, display_name AS "displayName", followers, following, posts, verified, clan_emoji AS "clanEmoji", updated_at AS "updatedAt"
      FROM user_stats
      WHERE username = ${username}
      LIMIT 1
    `;
    if (!rows.length) {
      return res.status(404).json({ error: 'Пользователь не найден в базе. Добавьте его и обновите данные.' });
    }
    res.json(rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка базы данных' });
  }
});

// Обновление данных через API
app.get('/refresh', async (req, res) => {
  const rows = await sql`SELECT username FROM tracked_users`;
  let updated = 0;

  for (const row of rows) {
    const username = row.username;
    try {
      const user = await client.getUserProfile(username);
      let clanEmoji = null;
      try {
        const clan = await client.getUserClan(username);
        clanEmoji = typeof clan === 'string' ? clan : (clan?.emoji || null);
      } catch (e) { /* игнорируем */ }

      await sql`
        INSERT INTO user_stats (username, display_name, followers, following, posts, verified, clan_emoji, updated_at)
        VALUES (${username}, ${user.displayName}, ${user.followersCount || 0}, ${user.followingCount || 0}, ${user.postsCount || 0}, ${user.verified || false}, ${clanEmoji}, NOW())
        ON CONFLICT (username) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          followers = EXCLUDED.followers,
          following = EXCLUDED.following,
          posts = EXCLUDED.posts,
          verified = EXCLUDED.verified,
          clan_emoji = EXCLUDED.clan_emoji,
          updated_at = NOW()
      `;
      updated++;
    } catch (e) {
      console.warn(`Не удалось обновить ${username}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 300));
  }

  res.json({ ok: true, updated, total: rows.length });
});

// Запуск: сначала база, потом сервер
initDb().then(() => {
  app.listen(3000, () => console.log('Сервер запущен: http://localhost:3000'));
}).catch(e => {
  console.error('Ошибка инициализации базы:', e);
  process.exit(1);
});