import { describe, expect, it } from 'vitest';
import { ExtractionError, extractJson, findJsonSpan, stripReasoning } from './extract-json.js';

describe('stripReasoning', () => {
  it('removes a closed think block', () => {
    const input = '<think>Let me work through this.</think>\n{"title":"Dal"}';
    expect(stripReasoning(input)).toBe('{"title":"Dal"}');
  });

  it('removes an unclosed think block, which means the reply was cut off', () => {
    expect(stripReasoning('<think>I was still reasoning when')).toBe('');
  });

  it('leaves a plain reply alone', () => {
    expect(stripReasoning('{"title":"Dal"}')).toBe('{"title":"Dal"}');
  });
});

describe('findJsonSpan', () => {
  it('finds an object inside a fenced code block', () => {
    const reply = 'Here you go:\n```json\n{"a":1}\n```\nHope that helps!';
    expect(findJsonSpan(reply)).toBe('{"a":1}');
  });

  it('handles braces inside strings without losing its place', () => {
    // The naive regex approach fails exactly here.
    const reply = '{"note":"use a 1/2 } cup","ok":true}';
    expect(findJsonSpan(reply)).toBe(reply);
  });

  it('handles escaped quotes inside strings', () => {
    const reply = String.raw`{"title":"Dadi\"s Aloo Gobi"}`;
    expect(findJsonSpan(reply)).toBe(reply);
  });

  it('handles nested objects and arrays', () => {
    const reply = 'text {"a":{"b":[1,2,{"c":3}]}} more text';
    expect(findJsonSpan(reply)).toBe('{"a":{"b":[1,2,{"c":3}]}}');
  });

  it('returns null when there is no JSON at all', () => {
    expect(findJsonSpan('I could not read that image, sorry.')).toBeNull();
  });
});

describe('extractJson', () => {
  it('parses the real shape qwen3.6 returns', () => {
    // This is an actual reply shape observed from qwen/qwen3.6-27b.
    const reply = [
      '<think>',
      'The user wants the recipe extracted.',
      '1. Title: Dadi\'s Aloo Gobi',
      '</think>',
      '',
      '```json',
      '{"title":"Dadi\'s Aloo Gobi","servings":4,"ingredients":[{"rawText":"2 medium potatoes, cubed"}]}',
      '```',
    ].join('\n');

    const parsed = extractJson<{ title: string; servings: number; ingredients: unknown[] }>(reply);
    expect(parsed.title).toBe("Dadi's Aloo Gobi");
    expect(parsed.servings).toBe(4);
    expect(parsed.ingredients).toHaveLength(1);
  });

  it('parses a bare object with no fence or preamble', () => {
    expect(extractJson<{ ok: boolean }>('{"ok":true}').ok).toBe(true);
  });

  it('ignores conversational preamble', () => {
    const parsed = extractJson<{ title: string }>('Sure! Here is the recipe:\n{"title":"Dal"}');
    expect(parsed.title).toBe('Dal');
  });

  it('recovers most of a reply truncated by the token limit', () => {
    // Better to hand the user a half-filled review screen than nothing.
    const truncated = '{"title":"Biryani","ingredients":[{"rawText":"rice"},{"rawText":"sa';
    const parsed = extractJson<{ title: string; ingredients: { rawText: string }[] }>(truncated);
    expect(parsed.title).toBe('Biryani');
    expect(parsed.ingredients[0]?.rawText).toBe('rice');
  });

  it('recovers when truncated on a dangling comma', () => {
    const truncated = '{"title":"Biryani","servings":4,';
    const parsed = extractJson<{ title: string; servings: number }>(truncated);
    expect(parsed.servings).toBe(4);
  });

  it('throws with the raw reply attached so the UI can show what came back', () => {
    try {
      extractJson('I could not read that image.');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ExtractionError);
      expect((error as ExtractionError).raw).toBe('I could not read that image.');
    }
  });
});
