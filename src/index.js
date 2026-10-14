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