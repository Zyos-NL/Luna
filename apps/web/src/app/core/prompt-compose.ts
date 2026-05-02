import type { AgeBand, BodyType, Character } from './character.service';

/**
 * Pure helpers for building Flux natural-language prompts from
 * Character + scene-form input. Kept out of WorkflowService so the
 * dialog (identity prompt) and generate-form (scene prompt) can both
 * compose without duplication, and so the logic is easy to unit-test.
 *
 * Flux uses natural language (no booru tags) — these helpers emit
 * comma-separated descriptive phrases, not weighted parens.
 */

const AGE_BAND_PHRASES: Record<AgeBand, string> = {
  'young-adult': 'young woman in her early twenties',
  'adult': 'woman in her thirties',
  'mature': 'mature woman in her forties',
};

const BODY_TYPE_PHRASES: Record<BodyType, string> = {
  slim: 'slim build',
  athletic: 'athletic build',
  curvy: 'curvy figure',
  plus: 'plus-size figure',
};

export interface ScenePromptInput {
  scene?: string;
  outfit?: string;
  poseText?: string;
  shot?: string;
  mood?: string;
}

/** Phrase derived purely from the character's candy.ai-style traits.
 *  Used as the leading sentence in both identity- and scene-prompts so
 *  Flux locks the look before scene/outfit/pose modifiers stack on. */
export function composeCharacterTraits(c: Partial<Character>): string {
  const fragments: string[] = [];

  // Lead with age + ethnicity → noun phrase (e.g., "Mediterranean woman in
  // her early twenties"). Falling back to plain "woman" when both are absent.
  const ageBand = c.ageBand ? AGE_BAND_PHRASES[c.ageBand] : '';
  const ethnicity = c.ethnicity?.trim();
  if (ethnicity && ageBand) {
    // Splice ethnicity into the age phrase: "young woman" -> "young Mediterranean woman".
    fragments.push(ageBand.replace('woman', `${ethnicity} woman`));
  } else if (ageBand) {
    fragments.push(ageBand);
  } else if (ethnicity) {
    fragments.push(`${ethnicity} woman`);
  } else {
    fragments.push('woman');
  }

  // Hair: "<color> <style> hair"
  const hair = [c.hairColor?.trim(), c.hairStyle?.trim()].filter(Boolean).join(' ');
  if (hair) fragments.push(`${hair} hair`);

  if (c.eyeColor?.trim()) fragments.push(`${c.eyeColor.trim()} eyes`);

  if (c.bodyType) fragments.push(BODY_TYPE_PHRASES[c.bodyType]);

  // Breast/butt: only emit when explicitly set so the default character
  // (no body-detail) doesn't pick up an arbitrary anatomy hint.
  if (c.breastSize) fragments.push(`${c.breastSize} breasts`);
  if (c.buttSize) fragments.push(`${c.buttSize} hips`);

  return fragments.join(', ');
}

/** Identity-portrait prompt: traits + framing for a clean reference shot.
 *  Used by the character dialog's Create-Identity flow. */
export function composeIdentityPrompt(c: Partial<Character>): string {
  const traits = composeCharacterTraits(c);
  return `${traits}, casual portrait photo, neutral background, soft natural lighting, looking at camera, photorealistic, high detail skin texture`;
}

/** Scene/generate prompt: traits + scene-form input, in an order that
 *  keeps Flux's attention on the character before the scene modifiers. */
export function composeScenePrompt(c: Partial<Character>, scene: ScenePromptInput): string {
  const traits = composeCharacterTraits(c);
  const fragments: string[] = [traits];

  if (scene.outfit?.trim()) fragments.push(`wearing ${scene.outfit.trim()}`);
  if (scene.scene?.trim()) fragments.push(scene.scene.trim());
  if (scene.poseText?.trim()) fragments.push(scene.poseText.trim());
  if (scene.shot?.trim()) fragments.push(`${scene.shot.trim()} shot`);
  if (scene.mood?.trim()) fragments.push(`${scene.mood.trim()} mood`);

  // Always close with the photoreal anchor — matches CHARACTER_CREATION
  // template's expectations and CLAUDE.md hard rule #14 (Skin-LoRA
  // baseline: photoreal, not anime/painterly).
  fragments.push('photorealistic, sharp focus, natural skin texture');

  return fragments.join(', ');
}
