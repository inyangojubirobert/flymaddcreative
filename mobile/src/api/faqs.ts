import { apiFetch } from '@/lib/api-client';

export type ProjectFaq = {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
};

export async function getProjectFaqs(token: string): Promise<ProjectFaq[]> {
  const data = await apiFetch<{ faqs: ProjectFaq[] }>('/api/onedream/faqs', { token });
  return data.faqs || [];
}
