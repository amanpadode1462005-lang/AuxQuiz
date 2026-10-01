// Vercel serverless function: POST /api/quiz
// Env: GROQ_API_KEY (required), GROQ_MODEL (optional), FIREBASE_API_KEY (optional)
const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FB_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyB42w1PQlyopaSoyQv4xcH0wtjyrItM9XY';

const verifyUser = async (token) => {
  if (!token) return false;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  return r.ok;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!(await verifyUser(token))) return res.status(401).json({ error: 'Please log in first.' });

    const { text, count = 5, difficulty = 'medium' } = req.body || {};
    if (!text || text.trim().length < 50) return res.status(400).json({ error: 'Add more study material (min 50 characters).' });
    const n = Math.min(Math.max(parseInt(count) || 5, 1), 20);

    const groq = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        reasoning_effort: 'low',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              `You create ${difficulty} multiple-choice quizzes strictly from the given study material. ` +
              `Return ONLY JSON: {"questions":[{"q":string,"options":[4 strings],"answer":0-3 index,"explanation":string}]}. ` +
              `Exactly ${n} questions; do not use facts outside the material.`,
          },
          { role: 'user', content: text.slice(0, 30000) },
        ],
      }),
    });

    const data = await groq.json();
    if (!groq.ok) return res.status(502).json({ error: data.error?.message || 'AI request failed' });

    const quiz = JSON.parse(data.choices[0].message.content);
    if (!Array.isArray(quiz.questions)) throw new Error('Bad AI response');
    return res.status(200).json(quiz);
  } catch (e) {
    return res.status(500).json({ error: 'Could not generate quiz. Please try again.' });
  }
};