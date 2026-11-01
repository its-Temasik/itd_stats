import { ITDClient } from 'itd-sdk-js';
import express from 'express';
import fs from 'fs';

const app = express();
app.use(express.json());
app.use(express.static('.'));

const DB_FILE = './tracked_users.json';
let trackedUsers = fs.existsSync(DB_FILE)
  ? JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'))
  : [];

const client = new ITDClient();

// Добавить username в отслеживание
app.post('/add', (req, res) => {
  const { username } = req.body;
  if (!username || trackedUsers.includes(username)) {
    return res.status(400).json({ error: 'username пуст или уже существует' });
  }
  trackedUsers.push(username);
  fs.writeFileSync(DB_FILE, JSON.stringify(trackedUsers));
  res.json({ ok: true, count: trackedUsers.length });
});

// Топ-100 по подписчикам
app.get('/top100', async (req, res) => {
  const results = [];

  for (const username of trackedUsers) {
    try {
      const user = await client.getUserProfile(username);

      // Получаем клан отдельным запросом
      let clanEmoji = null;
      try {
        const clan = await client.getUserClan(username);
        // getUserClan возвращает строку с эмодзи напрямую
        clanEmoji = typeof clan === 'string' ? clan : (clan?.emoji || null);
      } catch (e) {
        console.warn(`Не удалось получить клан для ${username}:`, e.message);
      }
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

  results.sort((a, b) => b.followers - a.followers);
  res.json(results.slice(0, 100));
});

app.listen(3000, () => console.log('Сервер запущен: http://localhost:3000'));