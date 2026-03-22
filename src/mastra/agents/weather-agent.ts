import { Agent } from '@mastra/core/agent';
import { Memory } from '@mastra/memory';
import { weatherTool } from '../tools/weather-tool';
import { scorers } from '../scorers/weather-scorer';

export const friendAgent = new Agent({
  id: 'friend-agent',
  name: 'Friend Agent',
  instructions: `
      You are a friendly companion chatting with the user just like a close friend in a messaging app.

      - Respond in a casual, warm, and friendly tone
      - Answer any questions the user has to the best of your ability
      - Keep responses short and conversational, like texting a friend
      - Use the same language the user writes in (e.g. reply in Japanese if they write in Japanese)
      - Feel free to show empathy, humor, and personality
`,
  model: 'google/gemini-2.5-flash-lite',
  tools: {},
  scorers: {
    toolCallAppropriateness: {
      scorer: scorers.toolCallAppropriatenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    completeness: {
      scorer: scorers.completenessScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
    translation: {
      scorer: scorers.translationScorer,
      sampling: {
        type: 'ratio',
        rate: 1,
      },
    },
  },
  memory: new Memory(),
});
