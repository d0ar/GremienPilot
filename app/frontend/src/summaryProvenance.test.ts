import { describe, expect, it } from 'vitest';
import { customPromptChanged, customPromptSha256 } from './summaryProvenance';

const EMPTY_PROMPT_SHA256 = 'a587e5af278a0326bea36c1c83eff693336978801b65c91042e81557cbe2ed0c';

describe('customPromptSha256', () => {
  it('matches the backend digest() serialization', async () => {
    // Values from summary_grounding.digest([gemma_summary.CUSTOM_SYSTEM, prompt]).
    expect(await customPromptSha256('Stil "A"\nÄ\tß \\ \u0001 € 😀'))
      .toBe('93ac6c2b63b9ed520dca869ad52d5ee441073aa0c0a9169c5b56341512412888');
    expect(await customPromptSha256('')).toBe(EMPTY_PROMPT_SHA256);
  });

  it('only compares custom-style summaries', async () => {
    const review = (summary_style: string) => ({ source_links: [], review_warnings: [],
      llm_usage: { summary_style, policy: { prompt_sha256: EMPTY_PROMPT_SHA256 } } });
    expect(await customPromptChanged(review('gemma4-custom'), '')).toBe(false);
    expect(await customPromptChanged(review('gemma4-custom'), 'neu')).toBe(true);
    expect(await customPromptChanged(review('gemma4-lora'), 'neu')).toBeNull();
    expect(await customPromptChanged({ source_links: [], review_warnings: [] }, 'neu')).toBeNull();
  });

  it('falls back to the stored request prompt without a stored hash', async () => {
    const review = { source_links: [], review_warnings: [], llm_usage: {
      summary_style: 'gemma4-custom', configuration: { custom_summary_prompt: 'alt' } } };
    expect(await customPromptChanged(review, 'alt')).toBe(false);
    expect(await customPromptChanged(review, 'neu')).toBe(true);
  });
});
