// Vercel serverless function: POST /api/quiz
// Generates MCQ, short-answer, or long-answer questions from supplied study material.

const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FB_KEY = process.env.FIREBASE_API_KEY || 'AIzaSyB42w1PQlyopaSoyQv4xcH0wtjyrItM9XY';

const verifyUser = async (token) => {
  if (!token) return false;

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FB_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: token }),
    }
  );

  return r.ok;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');

    if (!(await verifyUser(token))) {
      return res.status(401).json({ error: 'Please log in first.' });
    }

    const {
      text,
      count = 5,
      difficulty = 'medium',
      questionType = 'mcq',
    } = req.body || {};

    if (!text || text.trim().length < 50) {
      return res.status(400).json({
        error: 'Add more study material (min 50 characters).',
      });
    }

    const allowedTypes = ['mcq', 'short', 'long'];

    if (!allowedTypes.includes(questionType)) {
      return res.status(400).json({
        error: 'Invalid question type.',
      });
    }

    const n = Math.min(
      Math.max(parseInt(count) || 5, 5),
      50
    );

    let formatInstructions;

    if (questionType === 'mcq') {
      formatInstructions = `
Return ONLY JSON in this exact structure:
{
  "questions": [
    {
      "type": "mcq",
      "q": "question text",
      "options": ["option 1", "option 2", "option 3", "option 4"],
      "answer": 0,
      "explanation": "explanation"
    }
  ]
}

The "answer" must be the zero-based index of the correct option.
Each MCQ must have exactly four options.
`;
    } else if (questionType === 'short') {
      formatInstructions = `
Return ONLY JSON in this exact structure:
{
  "questions": [
    {
      "type": "short",
      "q": "question text"
    }
  ]
}
`;
    } else {
      formatInstructions = `
Return ONLY JSON in this exact structure:
{
  "questions": [
    {
      "type": "long",
      "q": "question text"
    }
  ]
}
`;
    }

    const groq = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          temperature: 0.4,
          reasoning_effort: 'low',
          response_format: { type: 'json_object' },

          messages: [
            {
              role: 'system',
              content:
                `You create ${difficulty} ${questionType} questions strictly from the supplied study material.

IMPORTANT RULES:
- Use ONLY information contained in the supplied study material.
- Do NOT use outside knowledge.
- Do NOT invent facts.
- Do NOT add information that cannot be supported by the supplied material.
- Generate exactly ${n} questions.
- Questions must be clear and academically useful.

${formatInstructions}`,
            },

            {
              role: 'user',
              content: text.slice(0, 30000),
            },
          ],
        }),
      }
    );

    const data = await groq.json();

    if (!groq.ok) {
      return res.status(502).json({
        error: data.error?.message || 'AI request failed',
      });
    }

    const quiz = JSON.parse(data.choices[0].message.content);

    if (!Array.isArray(quiz.questions)) {
      throw new Error('Bad AI response');
    }

    if (quiz.questions.length !== n) {
      throw new Error('AI returned incorrect question count');
    }

    return res.status(200).json(quiz);
  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: 'Could not generate quiz. Please try again.',
    });
  }
};