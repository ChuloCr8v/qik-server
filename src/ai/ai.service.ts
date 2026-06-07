import { Injectable } from '@nestjs/common';
import { UsageFeature } from '@prisma/client';
import { UsageService } from '../usage/usage.service';
import { PlanService } from '../plan/plan.service';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GeneratedAgendaItem {
  title: string;
  duration: number;
  description: string;
}

interface AgendaAnalysisItem {
  title: string;
  duration: number;
  description?: string;
}

@Injectable()
export class AiService {
  constructor(
    private readonly planService: PlanService,
    private readonly usageService: UsageService,
  ) {}

  async generateAgenda(userId: string, body: { meetingTitle: string; context: string; duration?: number; meetingId?: string }) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GROQ_API_KEY. Add it to your server environment before using AI features.');
    }

    const content = await this.createChatCompletion(apiKey, [
      {
        role: 'system',
        content: 'You are an expert meeting facilitator. Return only valid JSON that matches the requested schema.',
      },
      {
        role: 'user',
        content: `Generate a structured agenda for the following meeting.

Meeting Title: ${body.meetingTitle}
Meeting Goal/Context: ${body.context}
Total Duration: ${body.duration || 60} minutes

Create a focused agenda with clear objectives, discussion points, and time allocations.

Return JSON in this exact shape:
{
  "agenda": [
    {
      "title": "string",
      "duration": 10,
      "description": "string"
    }
  ]
}`,
      },
    ], true);

    const result = JSON.parse(content || '{}') as { agenda?: GeneratedAgendaItem[] };
    const agenda = Array.isArray(result.agenda) ? result.agenda : [];
    const plan = await this.planService.getUserPlan(userId);
    await this.usageService.logUsage(userId, plan.id, UsageFeature.AI_GENERATION, {
      meetingId: body.meetingId,
      itemCount: agenda.length,
    });

    return { agenda };
  }

  async analyzeAgenda(body: { meetingTitle: string; agendaItems: AgendaAnalysisItem[] }) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GROQ_API_KEY. Add it to your server environment before using AI features.');
    }

    const agendaText = (body.agendaItems || [])
      .map(item => `- ${item.title} (${item.duration}m): ${item.description || 'No description'}`)
      .join('\n');

    const analysis = await this.createChatCompletion(apiKey, [
      {
        role: 'system',
        content: 'You are an expert meeting facilitator. Keep feedback concise and actionable.',
      },
      {
        role: 'user',
        content: `Review the following meeting agenda and suggest 3 specific improvements or missing topics that would make the meeting more effective.

Meeting Title: ${body.meetingTitle}
Current Agenda:
${agendaText}

Provide your feedback in short, actionable bullet points.`,
      },
    ], false);

    return { analysis: analysis || 'No suggestions at this time.' };
  }

  private async createChatCompletion(
    apiKey: string,
    messages: Array<{ role: 'system' | 'user'; content: string }>,
    json: boolean,
  ) {
    const response = await fetch(GROQ_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        messages,
        temperature: 0.4,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Groq request failed (${response.status}): ${message}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || '';
  }
}
