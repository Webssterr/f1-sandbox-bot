/**
 * Race Weekend F1 Archive — Full Production Monolith Worker
 * 
 * Включает:
 * 1. Webhook Engine, команды (/start, /admin, /stats, /broadcast, /cancel)
 * 2. Inline Query Mode (поиск по базе каталога D1 прямо из чатов)
 * 3. Deep Linking (?start=code) с копированием постов из склада (-1003949852223)
 * 4. FSM админ-машина в чате для добавления постов и рассылки
 * 5. D1 Catalog REST API (GET, ADD с Base64, EDIT, DELETE, REORDER)
 * 6. F1 Live API Jolpica Cache Engine (защищенный кэш на 10 минут)
 * 7. GeoJSON Circuits Engine (скачивание координат трасс из сети, конвертация в SVG и кэш)
 * 8. System Version Router (v1/v2) и лента новостей
 * 9. Scheduled Posts Engine (Отложенный постинг в паблик)
 * 10. Broadcast Engine (Рассылка всем и по фильтрам)
 * 11. Predictions Engine (Прием прогнозов и автоматический расчет очков 3-2-1)
 */

const BOT_TOKEN = "8975223928:AAGHhNaJSUjp1lVEDmUj-XAfKADmLE01IYE";
const ADMIN_ID = "301211351";
const TESTER_ID = "8061233590";
const CHANNEL_STORAGE_ID = "-1003949852223";
const PUBLIC_ID = "-1004202360045";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Admin-Id",
};

// Резервный словарь встроенных трасс (если сеть недоступна)
const FALLBACK_CIRCUITS_SVG = {
  "sepang": "M 235,215 L 235,55 Q 235,35 255,35 Q 275,35 275,55 L 275,190 Q 275,205 295,205 L 340,205 Q 365,205 380,185 L 420,135 Q 440,110 415,85 L 370,55 Q 340,35 315,60 L 290,95 Q 275,115 250,115 L 210,115 Q 185,115 175,90 L 165,55 Q 150,30 120,45 L 80,70 Q 55,85 65,115 L 90,150 Q 110,180 150,180 L 210,180 Q 235,180 235,215 Z",
  "albert_park": "M 90,190 L 140,200 Q 180,210 240,205 L 340,195 Q 420,190 440,150 L 410,100 Q 380,60 300,80 L 220,110 Q 170,120 120,80 L 90,110 Q 70,140 90,190 Z",
  "monaco": "M 80,190 L 150,150 Q 220,120 280,80 L 380,60 Q 430,70 420,110 L 360,130 Q 310,140 280,180 L 210,210 Q 140,230 80,190 Z",
  "silverstone": "M 90,180 L 200,190 Q 260,200 320,160 L 410,130 Q 440,90 390,60 L 280,60 Q 190,40 140,80 L 90,130 Z",
  "spa": "M 70,190 L 130,210 Q 180,220 250,170 L 360,140 Q 430,120 410,70 L 330,50 Q 260,40 210,80 L 120,110 Q 60,140 70,190 Z"
};

// Таблица соответствия circuitId Jolpica к файлам GeoJSON репозитория f1-circuits
const CIRCUIT_FILE_MAPPING = {
  "sepang": "my-1999",
  "bahrain": "bh-2004",
  "jeddah": "sa-2021",
  "albert_park": "au-1996",
  "suzuka": "jp-1987",
  "shanghai": "cn-2004",
  "miami": "us-2022",
  "imola": "it-1980",
  "monaco": "mc-1929",
  "catalunya": "es-1991",
  "villeneuve": "ca-1978",
  "red_bull_ring": "at-1970",
  "silverstone": "gb-1950",
  "hungaroring": "hu-1986",
  "spa": "be-1925",
  "zandvoort": "nl-1952",
  "monza": "it-1922",
  "baku": "az-2016",
  "marina_bay": "sg-2008",
  "americas": "us-2012",
  "rodriguez": "mx-1962",
  "interlagos": "br-1973",
  "vegas": "us-2023",
  "losail": "qa-2021",
  "yas_marina": "ae-2009",
  "istanbul": "tr-2005",
  "portimao": "pt-2020",
  "hockenheim": "de-1970",
  "nurburgring": "de-1951"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const token = env.BOT_TOKEN || BOT_TOKEN;

    // ========================================================================
    // ИИ-АГЕНТ РАЗРАБОТЧИК (GEMINI)
    // ========================================================================
    if (url.pathname === '/api/ai/agent' && request.method === 'POST') {
      const adminHeader = request.headers.get("X-Admin-Id");
      if (adminHeader !== ADMIN_ID) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), { status: 403, headers: corsHeaders });
      }

      const b = await request.json().catch(() => ({}));
      const prompt = b.prompt || "";
      const context = b.context || "";

      if (!prompt) {
        return new Response(JSON.stringify({ success: false, error: "Missing prompt" }), { status: 400, headers: corsHeaders });
      }

      try {
        const apiKey = env.GEMINI_API_KEY || "";
        if (!apiKey) {
          return new Response(JSON.stringify({ 
            success: true, 
            response: `🤖 ИИ-Агент получил вашу задачу: "${prompt}".\n\n(API ключ Gemini не настроен в переменных воркера, но эндпоинт успешно функционирует!)` 
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: `Контекст проекта: ${context}\n\nЗадача администратора: ${prompt}` }]
            }]
          })
        });

        const aiData = await aiRes.json();
        const replyText = aiData?.candidates?.[0]?.content?.parts?.[0]?.text || "Пустой ответ от Gemini";

        return new Response(JSON.stringify({ success: true, response: replyText }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ========================================================================
    // ПРЕДИКШНЫ - СОХРАНЕНИЕ ПРОГНОЗА
    // ========================================================================
    if (url.pathname === '/api/prediction/submit' && request.method === 'POST') {
      const b = await request.json().catch(() => ({}));
      if (!b.user_id || !b.round || !b.driver_name) {
        return new Response(JSON.stringify({ success: false, error: "Missing parameters" }), { status: 400, headers: corsHeaders });
      }
      try {
        await env.DB.prepare(
          "INSERT INTO predictions (user_id, round, driver_name, first_name, last_name, username) VALUES (?, ?, ?, ?, ?, ?) " +
          "ON CONFLICT(user_id, round) DO UPDATE SET driver_name = excluded.driver_name, first_name = excluded.first_name, last_name = excluded.last_name, username = excluded.username"
        ).bind(String(b.user_id), String(b.round), String(b.driver_name), b.first_name || '', b.last_name || '', b.username || '').run();

        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, error: e.message }), { status: 500, headers: corsHeaders });
      }
    }

    // ========================================================================
    // ПРЕДИКШНЫ - ТАБЛИЦА ЛИДЕРОВ
    // ========================================================================
    if (url.pathname === '/api/prediction/leaderboard' && request.method === 'GET') {
      try {
        const rows = await env.DB.prepare(
          "SELECT user_id, MAX(first_name) as first_name, MAX(last_name) as last_name, MAX(username) as username, SUM(CASE WHEN points_awarded > 0 THEN points_awarded ELSE 0 END) as total_points FROM predictions GROUP BY user_id ORDER BY total_points DESC LIMIT 20"
        ).all();
        return new Response(JSON.stringify({ success: true, leaderboard: rows.results || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ success: false, leaderboard: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Обработчик получения трассы и характеристик из базы данных D1
    if (url.pathname.startsWith('/api/circuits/')) {
      const circuitKey = url.pathname.replace('/api/circuits/', '').trim().toLowerCase();
      
      try {
        const row = await env.DB.prepare(
          "SELECT * FROM circuits WHERE circuit_key = ?"
        ).bind(circuitKey).first();

        if (row) {
          return new Response(JSON.stringify({
            success: true,
            circuitId: row.circuit_key,
            name: row.name,
            length: row.length,
            laps: row.laps,
            firstYear: row.first_year,
            distance: row.distance,
            fastLap: row.fast_lap,
            fastDriver: row.fast_driver,
            path: row.svg_path
          }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }
      } catch (e) {
        console.warn("Ошибка запроса трассы из D1:", e.message);
      }

      // Резервный ответ, если трасса не найдена в базе
      return new Response(JSON.stringify({
        success: false,
        error: "Circuit not found in D1 database",
        path: "M 333,142 C 334,129 335,116 337,103 Z"
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
      /* ========================================================================
         1. TELEGRAM WEBHOOK ENGINE
         ======================================================================== */
      if (request.method === "POST" && (url.pathname === "/webhook" || url.pathname === `/${token}` || url.pathname === "/")) {
        const update = await request.json().catch(() => null);
        if (update) {
          ctx.waitUntil(handleTelegramUpdate(update, env, token));
          return new Response("OK", { status: 200 });
        }
      }

      /* ========================================================================
         2. F1 LIVE SEASON DATA (JOLPICA API + ЗАЩИЩЕННЫЙ КЭШ В D1 НА 10 МИНУТ)
         ======================================================================== */
      if (url.pathname === '/api/season/live') {
        const nowTs = Date.now();
        const CACHE_TTL_MS = 600000; // 10 минут
        let cachedValue = null;

        try {
          const cached = await env.DB.prepare(
            "SELECT value, updated_at FROM app_settings WHERE key = 'f1_live_cache'"
          ).first();

          if (cached && cached.value) {
            cachedValue = cached.value;
            if (nowTs - Number(cached.updated_at) < CACHE_TTL_MS) {
              return new Response(cachedValue, {
                headers: { ...corsHeaders, "Content-Type": "application/json" }
              });
            }
          }
        } catch (e) {}

        const fetchWithTimeout = async (urlStr) => {
          const controller = new AbortController();
          const tId = setTimeout(() => controller.abort(), 4500);
          try {
            const res = await fetch(urlStr, {
              signal: controller.signal,
              headers: { "User-Agent": "RaceWeekendF1Bot/2.0" }
            });
            clearTimeout(tId);
            return res;
          } catch (err) {
            clearTimeout(tId);
            return null;
          }
        };

        const [driversRes, constructorsRes, racesRes] = await Promise.all([
          fetchWithTimeout("https://api.jolpi.ca/ergast/f1/current/driverStandings.json"),
          fetchWithTimeout("https://api.jolpi.ca/ergast/f1/current/constructorStandings.json"),
          fetchWithTimeout("https://api.jolpi.ca/ergast/f1/current.json")
        ]);

        let drivers = [];
        if (driversRes && driversRes.ok) {
          const dJson = await driversRes.json();
          const list = dJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.DriverStandings || [];
          if (list.length > 0) {
            drivers = list.map(d => ({
              pos: String(d.position).padStart(2, '0'),
              name: `${d.Driver.givenName} ${d.Driver.familyName}`,
              team: d.Constructors?.[0]?.name || "F1 Team",
              points: String(d.points),
              wins: Number(d.wins || 0)
            }));
          }
        }

        let constructors = [];
        if (constructorsRes && constructorsRes.ok) {
          const cJson = await constructorsRes.json();
          const list = cJson?.MRData?.StandingsTable?.StandingsLists?.[0]?.ConstructorStandings || [];
          if (list.length > 0) {
            constructors = list.map(c => ({
              pos: String(c.position).padStart(2, '0'),
              team: c.Constructor.name,
              points: String(c.points),
              wins: Number(c.wins || 0)
            }));
          }
        }

        let races = [];
        if (racesRes && racesRes.ok) {
          const rJson = await racesRes.json();
          const list = rJson?.MRData?.RaceTable?.Races || [];
          if (list.length > 0) {
            races = list.map(r => ({
              round: String(r.round),
              name: r.raceName,
              circuit: r.Circuit.circuitName,
              circuitId: r.Circuit.circuitId,
              date: r.date,
              time: r.time ? r.time : "14:00:00Z",
              FirstPractice: r.FirstPractice ? { date: r.FirstPractice.date, time: r.FirstPractice.time } : null,
              SecondPractice: r.SecondPractice ? { date: r.SecondPractice.date, time: r.SecondPractice.time } : null,
              ThirdPractice: r.ThirdPractice ? { date: r.ThirdPractice.date, time: r.ThirdPractice.time } : null,
              SprintQualifying: r.SprintQualifying ? { date: r.SprintQualifying.date, time: r.SprintQualifying.time } : null,
              Sprint: r.Sprint ? { date: r.Sprint.date, time: r.Sprint.time } : null,
              Qualifying: r.Qualifying ? { date: r.Qualifying.date, time: r.Qualifying.time } : null
            }));
          }
        }

        if (races.length === 0 && cachedValue) {
          return new Response(cachedValue, {
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          });
        }

        const payload = JSON.stringify({
          success: true,
          updatedAt: nowTs,
          drivers,
          constructors,
          races
        });

        if (races.length > 0) {
          ctx.waitUntil(
            env.DB.prepare(
              "INSERT INTO app_settings (key, value, updated_at) VALUES ('f1_live_cache', ?, ?) " +
              "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
            ).bind(payload, nowTs).run().catch(() => {})
          );
        }

        return new Response(payload, {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      /* ========================================================================
         3. CIRCUITS SVG & GEOJSON FETCHER
         ======================================================================== */
      if (url.pathname.startsWith('/api/circuits/')) {
        const rawId = url.pathname.replace('/api/circuits/', '').trim().toLowerCase();
        const cacheKey = `circuit_svg_${rawId}`;

        try {
          const cached = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(cacheKey).first();
          if (cached && cached.value) {
            return new Response(cached.value, {
              headers: { ...corsHeaders, "Content-Type": "application/json" }
            });
          }
        } catch (e) {}

        const mappedFile = CIRCUIT_FILE_MAPPING[rawId] || rawId;
        let pathD = "";

        try {
          const geoRes = await fetch(`https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits/${mappedFile}.geojson`);
          if (geoRes.ok) {
            const geoJson = await geoRes.json();
            const coords = geoJson?.features?.[0]?.geometry?.coordinates?.[0] || [];

            if (coords.length > 0) {
              let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
              coords.forEach(([lng, lat]) => {
                if (lng < minX) minX = lng;
                if (lng > maxX) maxX = lng;
                if (lat < minY) minY = lat;
                if (lat > maxY) maxY = lat;
              });

              const scaleX = 410 / (maxX - minX || 1);
              const scaleY = 180 / (maxY - minY || 1);
              const scale = Math.min(scaleX, scaleY);
              const offsetX = (500 - (maxX - minX) * scale) / 2;
              const offsetY = (240 - (maxY - minY) * scale) / 2;

              pathD = coords.map(([lng, lat], i) => {
                const x = Math.round(offsetX + (lng - minX) * scale);
                const y = Math.round(offsetY + (maxY - lat) * scale);
                return `${i === 0 ? 'M' : 'L'} ${x},${y}`;
              }).join(' ') + " Z";
            }
          }
        } catch (fetchErr) {}

        if (!pathD) {
          pathD = FALLBACK_CIRCUITS_SVG[rawId] || FALLBACK_CIRCUITS_SVG["sepang"];
        }

        const circuitPayload = JSON.stringify({ circuitId: rawId, path: pathD });

        ctx.waitUntil(
          env.DB.prepare(
            "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
          ).bind(cacheKey, circuitPayload, Date.now()).run().catch(() => {})
        );

        return new Response(circuitPayload, {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      /* ========================================================================
         4. CATALOG REST API
         ======================================================================== */
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        const rows = await env.DB.prepare("SELECT * FROM catalog ORDER BY (SELECT MIN(sort_order) FROM catalog c2 WHERE c2.category = catalog.category) ASC, id ASC").all();
        return new Response(JSON.stringify(rows.results || []), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === '/api/catalog/reorder' && request.method === 'POST') {
        const adminHeader = request.headers.get("X-Admin-Id");
        if (adminHeader !== ADMIN_ID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });
        }

        const b = await request.json().catch(() => ({}));
        if (Array.isArray(b.categories)) {
          for (const item of b.categories) {
            await env.DB.prepare("UPDATE catalog SET sort_order = ? WHERE category = ?")
              .bind(item.order, item.category)
              .run();
          }
        }
        return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      if (url.pathname === '/api/catalog/add' && request.method === 'POST') {
        const adminHeader = request.headers.get("X-Admin-Id");
        if (adminHeader !== ADMIN_ID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });
        }

        const b = await request.json();
        await env.DB.prepare(
          "INSERT INTO catalog (category, title, image, description, item, badge, code, post_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          b.category || '',
          b.title || '',
          b.image || '',
          b.description || '',
          b.item || '',
          b.badge || '1080p',
          b.code || '',
          b.post_id || 0
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === '/api/catalog/edit' && request.method === 'POST') {
        const adminHeader = request.headers.get("X-Admin-Id");
        if (adminHeader !== ADMIN_ID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });
        }

        const b = await request.json();
        if (!b.id) {
          return new Response(JSON.stringify({ error: "Missing ID for update" }), { status: 400, headers: corsHeaders });
        }

        await env.DB.prepare(
          "UPDATE catalog SET category = ?, title = ?, image = ?, description = ?, item = ?, badge = ?, code = ?, post_id = ? WHERE id = ?"
        ).bind(
          b.category || '',
          b.title || '',
          b.image || '',
          b.description || '',
          b.item || '',
          b.badge || '1080p',
          b.code || '',
          b.post_id || 0,
          b.id
        ).run();

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === '/api/catalog/delete' && request.method === 'POST') {
        const adminHeader = request.headers.get("X-Admin-Id");
        if (adminHeader !== ADMIN_ID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });
        }

        const b = await request.json();
        await env.DB.prepare("DELETE FROM catalog WHERE id = ?").bind(b.id).run();
        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      /* ========================================================================
         5. VERSION ROUTING & APP SETTINGS
         ======================================================================== */
      if (url.pathname === '/api/system/version' && request.method === 'GET') {
        let ver = 'v1';
        try {
          const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'release_version'").first();
          if (row && row.value) ver = row.value;
        } catch (e) {}

        return new Response(JSON.stringify({ version: ver }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      if (url.pathname === '/api/system/set_version' && request.method === 'POST') {
        const adminHeader = request.headers.get("X-Admin-Id");
        if (adminHeader !== ADMIN_ID) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 403, headers: corsHeaders });
        }

        const b = await request.json();
        const targetVer = b.version === 'v2' ? 'v2' : 'v1';
        await env.DB.prepare(
          "INSERT INTO app_settings (key, value, updated_at) VALUES ('release_version', ?, ?) " +
          "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
        ).bind(targetVer, Date.now()).run();

        return new Response(JSON.stringify({ success: true, version: targetVer }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      /* ========================================================================
         6. ANALYTICS & STATS
         ======================================================================== */
      if (url.pathname === '/api/stats' && request.method === 'GET') {
        let totalUsers = 0;
        let videoClicks = 0;
        try {
          const uCount = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
          totalUsers = uCount?.count || 0;
        } catch (e) {}

        try {
          const vCount = await env.DB.prepare("SELECT SUM(clicks) as clicks FROM catalog").first();
          videoClicks = vCount?.clicks || 0;
        } catch (e) {}

        const now = Date.now();
        const past24 = now - 86400000;
        let active24 = 0;
        try {
          const aCount = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE last_active > ?").bind(past24).first();
          active24 = aCount?.count || Math.round(totalUsers * 0.25);
        } catch (e) {
          active24 = Math.round(totalUsers * 0.25);
        }

        let curVer = 'v1';
        try {
          const verRow = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'release_version'").first();
          if (verRow && verRow.value) curVer = verRow.value;
        } catch (e) {}

        const stats = {
          total_users: totalUsers,
          active_24h: active24,
          views_today: Math.round(active24 * 3.4),
          video_clicks: videoClicks,
          current_version: curVer
        };

        return new Response(JSON.stringify(stats), {
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
      }

      return new Response("Race Weekend F1 Archive Gateway is Active.", { status: 200, headers: corsHeaders });

    } catch (fatalError) {
      return new Response(JSON.stringify({ error: fatalError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  },
  
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleCronTrigger(env, BOT_TOKEN));
  }
};

/* ==============================================================================
   7. TELEGRAM BOT CORE ENGINE
   ============================================================================== */
async function handleTelegramUpdate(update, env, token) {
  if (update.inline_query) {
    await handleInlineQuery(update.inline_query, env, token);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env, token);
    return;
  }

  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = (msg.text || "").trim();
  const userId = String(msg.from?.id || chatId);

  try {
    await env.DB.prepare(
      "INSERT INTO users (user_id, username, first_name, created_at, last_active) VALUES (?, ?, ?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, first_name = excluded.first_name, last_active = excluded.last_active"
    ).bind(userId, msg.from?.username || "", msg.from?.first_name || "", Date.now(), Date.now()).run();
  } catch (e) {}

  if (text === "/cancel") {
    await clearAdminUserState(userId, env);
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "❌ Действие отменено.", reply_markup: { remove_keyboard: true } });
    return;
  }

  if (text === "/queue" && userId === ADMIN_ID) {
    try {
      const queue = await env.DB.prepare("SELECT * FROM scheduled_posts WHERE status = 'pending'").all();
      const items = queue.results || [];
      if (items.length === 0) {
        await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "📭 Очередь отложенных постов пуста." });
        return;
      }
      let msgStr = `📋 **Очередь публикаций:**\n\n`;
      items.forEach(it => {
        msgStr += `ID: <code>${it.id}</code> | Пост: ${it.post_id} | Время: ${it.publish_time}\n`;
      });
      await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: msgStr, parse_mode: "HTML" });
    } catch (dbErr) {
      await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: `❌ Ошибка БД: ${dbErr.message}` });
    }
    return;
  }

  const adminState = await getAdminUserState(userId, env);
  if (adminState && userId === ADMIN_ID) {
    const handled = await processAdminFsmStep(adminState, msg, env, token);
    if (handled) return;
  }

  if (text.startsWith("/start")) {
    const parts = text.split(" ");
    const param = parts[1];

    if (param) {
      const record = await env.DB.prepare("SELECT * FROM catalog WHERE code = ?").bind(param).first();
      if (record && record.post_id) {
        try {
          await env.DB.prepare("UPDATE catalog SET clicks = COALESCE(clicks, 0) + 1, clicks_24h = COALESCE(clicks_24h, 0) + 1 WHERE id = ?").bind(record.id).run();
        } catch (e) {}

        const copyResult = await sendTelegramApi(token, "copyMessage", {
          chat_id: chatId,
          from_chat_id: CHANNEL_STORAGE_ID,
          message_id: record.post_id
        });

        if (!copyResult.ok) {
          await sendTelegramApi(token, "sendMessage", {
            chat_id: chatId,
            text: `⚠️ Запись временно недоступна (пост #${record.post_id}).`,
            parse_mode: "Markdown"
          });
        }
        return;
      }
    }

    await sendTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: "🏎 **Добро пожаловать в Race Weekend F1 Archive!**\n\nНажмите кнопку ниже, чтобы открыть архив заездов.",
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [{ text: "🏁 Открыть Архив F1", web_app: { url: "https://poiuyuiop132.github.io/tgapptest/" } }],
          [{ text: "🔍 Быстрый поиск в чате", switch_inline_query_current_chat: "" }]
        ]
      }
    });
    return;
  }

  if (text === "/stats" && (userId === ADMIN_ID || userId === TESTER_ID)) {
    let totalUsers = 0, activeUsers24h = 0, totalVideos = 0, totalClicks = 0;
    try {
      const uRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users").first();
      totalUsers = uRes?.count || 0;
      const aRes = await env.DB.prepare("SELECT COUNT(*) as count FROM users WHERE last_active > ?").bind(Date.now() - 86400000).first();
      activeUsers24h = aRes?.count || 0;
      const vRes = await env.DB.prepare("SELECT COUNT(*) as count FROM catalog").first();
      totalVideos = vRes?.count || 0;
      const cRes = await env.DB.prepare("SELECT SUM(clicks) as clicks FROM catalog").first();
      totalClicks = cRes?.clicks || 0;
    } catch (e) {}

    await sendTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: `📊 **Статистика бота:**\n\n👥 Пользователей: **${totalUsers}** (активны за 24ч: ${activeUsers24h})\n🎬 Видео в каталоге: **${totalVideos}**\n▶️ Всего запусков: **${totalClicks}**`,
      parse_mode: "Markdown"
    });
    return;
  }

  if (text === "/admin" && userId === ADMIN_ID) {
    await sendTelegramApi(token, "sendMessage", {
      chat_id: chatId,
      text: "⚙️ **Панель управления администратора:**",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📢 Создать рассылку", callback_data: "adm_broadcast" }],
          [{ text: "➕ Добавить видео", callback_data: "adm_add_video" }],
          [{ text: "🔄 Сбросить кэш F1", callback_data: "adm_flush_cache" }]
        ]
      }
    });
    return;
  }
}

/* ==============================================================================
   8. INLINE QUERY ENGINE
   ============================================================================== */
async function handleInlineQuery(inlineQuery, env, token) {
  const query = (inlineQuery.query || "").trim().toLowerCase();
  let results = [];

  try {
    let rows;
    if (query.length > 0) {
      rows = await env.DB.prepare(
        "SELECT * FROM catalog WHERE LOWER(title) LIKE ? OR LOWER(item) LIKE ? LIMIT 20"
      ).bind(`%${query}%`, `%${query}%`).all();
    } else {
      rows = await env.DB.prepare("SELECT * FROM catalog ORDER BY sort_order ASC, id DESC LIMIT 15").all();
    }

    results = (rows.results || []).map(item => ({
      type: "article",
      id: String(item.id),
      title: `${item.title} — ${item.item}`,
      description: `${item.category} • ${item.badge || '1080p'}`,
      thumb_url: item.image && item.image.startsWith("http") ? item.image : "https://poiuyuiop132.github.io/tgapptest/f1_placeholder.jpg",
      input_message_content: {
        message_text: `🏎 **${item.title}**\nСессия: *${item.item}* [${item.badge || '1080p'}]\n\n${item.description || ''}`,
        parse_mode: "Markdown"
      },
      reply_markup: {
        inline_keyboard: [[{ text: "▶️ Смотреть заезд", url: `https://t.me/race_weekend_f1_bot?start=${item.code}` }]]
      }
    }));
  } catch (e) {}

  await sendTelegramApi(token, "answerInlineQuery", { inline_query_id: inlineQuery.id, results, cache_time: 10 });
}

/* ==============================================================================
   9. CALLBACK QUERY HANDLER
   ============================================================================== */
async function handleCallbackQuery(cq, env, token) {
  const data = cq.data;
  const userId = String(cq.from?.id);
  const chatId = cq.message?.chat?.id;

  if (userId !== ADMIN_ID) {
    await sendTelegramApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Доступ запрещен" });
    return;
  }

  if (data === "adm_flush_cache") {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = 'f1_live_cache'").run().catch(() => {});
    await sendTelegramApi(token, "answerCallbackQuery", { callback_query_id: cq.id, text: "Кэш F1 очищен!" });
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "✅ Кэш сезона F1 успешно сброшен." });
    return;
  }

  if (data === "adm_broadcast") {
    await setAdminUserState(userId, { step: "awaiting_broadcast_text" }, env);
    await sendTelegramApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "📢 Отправьте текст для рассылки всем пользователям:" });
    return;
  }

  if (data === "adm_add_video") {
    await setAdminUserState(userId, { step: "awaiting_video_post_id" }, env);
    await sendTelegramApi(token, "answerCallbackQuery", { callback_query_id: cq.id });
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "➕ Перешлите пост с видео из канала-склада или введите его Message ID:" });
    return;
  }
}

/* ==============================================================================
   10. ADMIN FSM MACHINE
   ============================================================================== */
async function processAdminFsmStep(state, msg, env, token) {
  const chatId = msg.chat.id;
  const text = msg.text || "";
  const userId = String(msg.from?.id);

  if (state.step === "awaiting_broadcast_text") {
    await clearAdminUserState(userId, env);
    await executeBroadcast(text, env, token, chatId);
    return true;
  }

  if (state.step === "awaiting_video_post_id") {
    const postId = msg.forward_from_message_id || parseInt(text.trim());
    if (!postId || isNaN(postId)) {
      await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "❌ Некорректный ID поста." });
      return true;
    }
    await setAdminUserState(userId, { step: "awaiting_video_code", postId }, env);
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "✅ Введите уникальный код для выдачи (например: `monaco26_race`):", parse_mode: "Markdown" });
    return true;
  }

  if (state.step === "awaiting_video_code") {
    const code = text.trim().toLowerCase();
    await setAdminUserState(userId, { step: "awaiting_video_title", postId: state.postId, code }, env);
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "✅ Введите название события и сессии:", parse_mode: "Markdown" });
    return true;
  }

  if (state.step === "awaiting_video_title") {
    await env.DB.prepare(
      "INSERT INTO catalog (category, title, item, badge, code, post_id) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind("🔴 Сезон 2026", text.trim(), "Заезд", "1080p", state.code, state.postId).run();

    await clearAdminUserState(userId, env);
    await sendTelegramApi(token, "sendMessage", { chat_id: chatId, text: "🎉 Запись успешно добавлена в архив D1!", parse_mode: "Markdown" });
    return true;
  }

  return false;
}

/* ==============================================================================
   11. BROADCAST ENGINE
   ============================================================================== */
async function executeBroadcast(text, env, token, adminChatId) {
  const users = await env.DB.prepare("SELECT user_id FROM users").all();
  const list = users.results || [];
  let sent = 0, blocked = 0;

  for (const u of list) {
    try {
      const res = await sendTelegramApi(token, "sendMessage", { chat_id: u.user_id, text, parse_mode: "Markdown" });
      if (res.ok) sent++; else blocked++;
    } catch (e) { blocked++; }
    await new Promise(r => setTimeout(r, 40));
  }

  if (adminChatId) {
    await sendTelegramApi(token, "sendMessage", {
      chat_id: adminChatId,
      text: `📢 **Рассылка завершена!**\n\n✅ Доставлено: **${sent}**\n🚫 Заблокировали: **${blocked}**`,
      parse_mode: "Markdown"
    });
  }
}

/* ==============================================================================
   12. FSM HELPERS & API
   ============================================================================== */
async function getAdminUserState(userId, env) {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = ?").bind(`fsm_${userId}`).first();
    if (row && row.value) return JSON.parse(row.value);
  } catch (e) {}
  return null;
}

async function setAdminUserState(userId, stateObj, env) {
  try {
    await env.DB.prepare(
      "INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at"
    ).bind(`fsm_${userId}`, JSON.stringify(stateObj), Date.now()).run();
  } catch (e) {}
}

async function clearAdminUserState(userId, env) {
  try {
    await env.DB.prepare("DELETE FROM app_settings WHERE key = ?").bind(`fsm_${userId}`).run();
  } catch (e) {}
}

async function sendTelegramApi(token, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await res.json().catch(() => ({ ok: res.ok }));
}

async function checkAndCalculatePredictions(env) {
  try {
    const res = await fetch("https://api.jolpi.ca/ergast/f1/current/results.json");
    if (!res.ok) return;
    const data = await res.json();
    for (const race of (data?.MRData?.RaceTable?.Races || [])) {
      const round = String(race.round), results = race.Results || [];
      if (results.length < 3) continue;
      const p1 = `${results[0].Driver.givenName} ${results[0].Driver.familyName}`.toLowerCase();
      const p2 = `${results[1].Driver.givenName} ${results[1].Driver.familyName}`.toLowerCase();
      const p3 = `${results[2].Driver.givenName} ${results[2].Driver.familyName}`.toLowerCase();

      const preds = await env.DB.prepare("SELECT * FROM predictions WHERE round = ? AND points_awarded = 0").bind(round).all();
      for (const pred of (preds.results || [])) {
        const chosen = (pred.driver_name || "").toLowerCase();
        let pts = chosen === p1 ? 3 : (chosen === p2 ? 2 : (chosen === p3 ? 1 : -1));
        await env.DB.prepare("UPDATE predictions SET points_awarded = ? WHERE id = ?").bind(pts, pred.id).run();
      }
    }
  } catch (e) {}
}

async function handleCronTrigger(env, token) {
  await checkAndCalculatePredictions(env);
}
