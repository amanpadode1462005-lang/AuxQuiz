// Vercel serverless function: POST /api/check-answer
// Evaluates a student's text answer strictly against supplied textbook material.

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
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');

    if (!(await verifyUser(token))) {
      return res.status(401).json({
        error: 'Please log in first.',
      });
    }

    const {
      question,
      studentAnswer,
      textbookContext,
    } = req.body || {};

    if (!question || !studentAnswer || !textbookContext) {
      return res.status(400).json({
        error: 'Question, answer and textbook material are required.',
      });
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
          temperature: 0.1,
          reasoning_effort: 'low',
          response_format: {
            type: 'json_object',
          },

          messages: [
            {
              role: 'system',
              content: `
You are a strict academic answer evaluator.

Evaluate the student's answer ONLY using the supplied textbook material.

DO NOT:
- Use general knowledge.
- Use information from the internet.
- Add facts that are not present in the textbook material.
- Give credit for claims that cannot be supported by the supplied material.

Give a score from 0 to 10.

Consider:
- Accuracy
- Coverage of important points present in the textbook material
- Relevance to the question
- Clarity

Return ONLY JSON in this exact structure:

{
  "score": 0,
  "feedback": "brief explanation",
  "missing_points": ["point 1", "point 2"]
}

The score must be an integer from 0 to 10.
`,

            },

            {
              role: 'user',
              content: `
QUESTION:
${question}

STUDENT ANSWER:
${studentAnswer}

TEXTBOOK MATERIAL:
${textbookContext.slice(0, 30000)}
`,
            },
          ],
        }),
      }
    );

    const data = await groq.json();

    if (!groq.ok) {
      return res.status(502).json({
        error: data.error?.message || 'AI evaluation failed',
      });
    }

    const result = JSON.parse(
      data.choices[0].message.content
    );

    if (
      typeof result.score !== 'number' ||
      result.score < 0 ||
      result.score > 10
    ) {
      throw new Error('Invalid score returned by AI');
    }

    return res.status(200).json({
      score: Math.round(result.score),
      feedback: result.feedback || '',
      missing_points: Array.isArray(result.missing_points)
        ? result.missing_points
        : [],
    });

  } catch (e) {
    console.error(e);

    return res.status(500).json({
      error: 'Could not evaluate the answer.',
    });
  }
};