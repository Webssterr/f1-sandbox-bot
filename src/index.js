import html from '../index.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Serve static frontend (index.html)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(html, {
        headers: { 'Content-Type': 'text/html;charset=UTF-8' },
      });
    }

    // CORS Headers for API
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Id',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Handle APIs
    try {
      // API: Init DB
      if (url.pathname === '/api/init' && request.method === 'GET') {
          try {
              await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_team (user_id TEXT PRIMARY KEY, driver1 TEXT, driver2 TEXT, constructor TEXT, updated_at DATETIME)`).run();
              await env.DB.prepare(`CREATE TABLE IF NOT EXISTS quiz_questions (id INTEGER PRIMARY KEY AUTOINCREMENT, question TEXT, options TEXT, correct_answer TEXT, created_at DATETIME)`).run();
              await env.DB.prepare(`CREATE TABLE IF NOT EXISTS user_stats (user_id TEXT PRIMARY KEY, coins INTEGER, achievements TEXT)`).run();
              return new Response(JSON.stringify({success: true}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({error: e.message}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      // API: Catalog
      if (url.pathname === '/api/catalog' && request.method === 'GET') {
        let results = [];
        try {
          const { results: dbResults } = await env.DB.prepare(
            'SELECT * FROM catalog ORDER BY sort_order ASC, id DESC'
          ).all();
          results = dbResults;
        } catch (e) {
          // Table might not exist initially, return empty
          results = [];
        }
        return new Response(JSON.stringify(results), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // API: Reorder categories
      if (url.pathname === '/api/admin/reorder' && request.method === 'POST') {
        const adminId = request.headers.get('X-Admin-Id');
        // Basic auth check based on frontend expectations
        if (adminId !== '301211351') {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const body = await request.json();
        const { categories } = body; // Array of { category: string, order: number }

        if (categories && categories.length > 0) {
            // Update sort order based on new array
            // D1 batching allows us to send multiple updates at once
            const statements = [];
            for (const item of categories) {
                statements.push(
                    env.DB.prepare('UPDATE catalog SET sort_order = ? WHERE category = ?')
                          .bind(item.order, item.category)
                );
            }
            if (statements.length > 0) {
               await env.DB.batch(statements);
            }
        }

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }

      // API: Add Catalog Item
      if (url.pathname === '/api/catalog/add' && request.method === 'POST') {
        const adminId = request.headers.get('X-Admin-Id');
        if (adminId !== '301211351') {
          return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
        }

        const body = await request.json();
        const { category, title, image, description, item, badge, code, post_id, notify_users } = body;

        await env.DB.prepare(
          `INSERT INTO catalog (category, title, image, description, item, badge, code, post_id, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(category, title, image || '', description || '', item, badge || '1080p', code, post_id, 999).run();

        // If notify_users is true, we would typically call Telegram API here
        if (notify_users) {
            console.log(`Telegram Notification Triggered: New content added in ${category} - ${title}`);
            // await fetch(`https://api.telegram.org/bot<TOKEN>/sendMessage...`)
        }

        return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
      }


      // API: Fantasy Team
      if (url.pathname === '/api/fantasy/team' && request.method === 'GET') {
          const userId = url.searchParams.get('userId');
          if (!userId) return new Response(JSON.stringify({error: 'userId required'}), {status: 400, headers: corsHeaders});

          try {
              let team = await env.DB.prepare('SELECT * FROM user_team WHERE user_id = ?').bind(userId).first();
              return new Response(JSON.stringify(team || {}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      if (url.pathname === '/api/fantasy/team' && request.method === 'POST') {
          const body = await request.json();
          const { userId, driver1, driver2, constructor } = body;
          if (!userId) return new Response(JSON.stringify({error: 'userId required'}), {status: 400, headers: corsHeaders});

          try {
              // Basic init if table missing


              await env.DB.prepare(`
                  INSERT INTO user_team (user_id, driver1, driver2, constructor, updated_at)
                  VALUES (?, ?, ?, ?, datetime('now'))
                  ON CONFLICT(user_id) DO UPDATE SET driver1=excluded.driver1, driver2=excluded.driver2, constructor=excluded.constructor, updated_at=datetime('now')
              `).bind(userId, driver1 || '', driver2 || '', constructor || '').run();

              return new Response(JSON.stringify({success: true}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({success: false, error: e.message}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      // API: Quizzes
      if (url.pathname === '/api/quiz' && request.method === 'GET') {
          try {
              // Ensure table exists

              // Get a random question
              const question = await env.DB.prepare('SELECT id, question, options FROM quiz_questions ORDER BY RANDOM() LIMIT 1').first();
              return new Response(JSON.stringify(question || {}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      if (url.pathname === '/api/quiz/answer' && request.method === 'POST') {
          const body = await request.json();
          const { userId, questionId, answer } = body;

          try {
              const question = await env.DB.prepare('SELECT correct_answer FROM quiz_questions WHERE id = ?').bind(questionId).first();
              if (question && question.correct_answer === answer) {
                  return new Response(JSON.stringify({correct: true}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
              } else {
                  return new Response(JSON.stringify({correct: false}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
              }
          } catch(e) {
              return new Response(JSON.stringify({error: e.message}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      // API: User Stats (Coins & Achievements)
      if (url.pathname === '/api/user/stats' && request.method === 'GET') {
          const userId = url.searchParams.get('userId');
          if (!userId) return new Response(JSON.stringify({error: 'userId required'}), {status: 400, headers: corsHeaders});

          try {
              let stats = await env.DB.prepare('SELECT * FROM user_stats WHERE user_id = ?').bind(userId).first();
              return new Response(JSON.stringify(stats || { coins: 0, achievements: '[]' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({ coins: 0, achievements: '[]' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      if (url.pathname === '/api/user/stats' && request.method === 'POST') {
          const body = await request.json();
          const { userId, coins, achievements } = body;
          if (!userId) return new Response(JSON.stringify({error: 'userId required'}), {status: 400, headers: corsHeaders});

          try {

              await env.DB.prepare(`
                  INSERT INTO user_stats (user_id, coins, achievements)
                  VALUES (?, ?, ?)
                  ON CONFLICT(user_id) DO UPDATE SET coins=excluded.coins, achievements=excluded.achievements
              `).bind(userId, coins || 0, achievements || '[]').run();

              return new Response(JSON.stringify({success: true}), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          } catch(e) {
              return new Response(JSON.stringify({success: false, error: e.message}), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
          }
      }

      // API: Circuits D1
      if (url.pathname.startsWith('/api/circuits/') && request.method === 'GET') {
          const circuitKey = url.pathname.split('/').pop().toLowerCase();
          try {
             await env.DB.prepare(`CREATE TABLE IF NOT EXISTS circuits (key TEXT PRIMARY KEY, name TEXT, path TEXT, length REAL, laps INTEGER, firstYear INTEGER, distance REAL)`).run();
             const count = await env.DB.prepare('SELECT COUNT(*) as c FROM circuits').first();
             if (count && count.c === 0) {
                 const stmts = [
                     env.DB.prepare("INSERT INTO circuits (key, name, path, length, laps, firstYear, distance) VALUES ('monaco', 'Монако', 'M100 100 Q 150 50, 200 100 T 300 200 T 150 250 Z', 3.337, 78, 1950, 260.286)"),
                     env.DB.prepare("INSERT INTO circuits (key, name, path, length, laps, firstYear, distance) VALUES ('silverstone', 'Сильверстоун', 'M150 50 L 300 100 Q 350 150, 250 250 L 100 200 Z', 5.891, 52, 1950, 306.198)"),
                     env.DB.prepare("INSERT INTO circuits (key, name, path, length, laps, firstYear, distance) VALUES ('monza', 'Монца', 'M50 150 L 350 150 Q 400 200, 350 250 L 50 250 Z', 5.793, 53, 1950, 306.720)")
                 ];
                 await env.DB.batch(stmts);
             }

             const circuit = await env.DB.prepare('SELECT * FROM circuits WHERE key LIKE ?').bind('%' + circuitKey + '%').first();
             if (circuit) {
                 return new Response(JSON.stringify({
                     success: true,
                     path: circuit.path,
                     name: circuit.name,
                     length: circuit.length,
                     laps: circuit.laps,
                     firstYear: circuit.firstYear,
                     distance: circuit.distance
                 }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
             } else {
                 return new Response(JSON.stringify({ error: 'Circuit not found' }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }});
             }
          } catch(e) {
              return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
      }

      // API: Season stats mock
      if (url.pathname === '/api/season/live' && request.method === 'GET') {
          // Returning empty allows the frontend to fallback to default data,
          // or we can query a real table. We'll return 404 so frontend handles it cleanly.
          return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: corsHeaders });
      }

      // Fallback
      return new Response('Not Found', { status: 404 });

    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  // 4. Implement Cron/AI Logic
  async scheduled(event, env, ctx) {
    // 0 0 * * * - Daily at midnight (Quiz generation)
    if (event.cron === "0 0 * * *") {
        console.log("Running Daily Quiz Generator via AI");
        try {
            const prompt = "Generate a challenging multiple choice quiz question about Formula 1 history. Return ONLY a valid JSON object with the following keys: 'question' (string), 'options' (array of 4 strings), 'correct_answer' (string matching one of the options). Do not wrap in markdown.";

            // Call Cloudflare Workers AI
            const response = await env.AI.run('@cf/meta/llama-3-8b-instruct', {
                messages: [{ role: 'user', content: prompt }]
            });

            const rawJson = response.response.trim();
            // Basic cleanup in case AI added markdown
            const cleanJson = rawJson.replace(/```json/g, '').replace(/```/g, '').trim();

            const quizData = JSON.parse(cleanJson);

            if (quizData.question && quizData.options && quizData.correct_answer) {
                 await env.DB.prepare(
                    `INSERT INTO quiz_questions (question, options, correct_answer, created_at) VALUES (?, ?, ?, datetime('now'))`
                ).bind(
                    quizData.question,
                    JSON.stringify(quizData.options),
                    quizData.correct_answer
                ).run();
                console.log("Quiz generated successfully");
            }
        } catch (e) {
            console.error("AI Quiz generation failed:", e);
        }
    }

    // 0 * * * * - Hourly notification checks
    if (event.cron === "0 * * * *") {
        console.log("Checking for upcoming sessions to notify users");
        // Logic to check D1 for sessions starting in < 60 minutes
        // and trigger Telegram API would go here.
    }
  }
};