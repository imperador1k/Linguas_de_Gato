import type { ModelAssessment, SpeakingAssessment } from '../contracts/speaking.js';
import { flattenTranscript, locateQuote, type EvidenceSegment } from './transcript-evidence.js';

/**
 * Evidence verification for AI speaking feedback. A language model can
 * misquote or invent mistakes; showing those as the learner's errors would be
 * harmful. Every correction and exercise must quote words that actually occur
 * in the confirmed transcript. Claims that fail are dropped and counted,
 * never shown.
 */
export function verifyAssessmentEvidence(model: ModelAssessment, segments: readonly EvidenceSegment[]): SpeakingAssessment {
  const flat = flattenTranscript(segments);
  const knownIds = new Set(segments.map((segment) => segment.id));

  const issues: SpeakingAssessment['issues'] = [];
  for (const issue of model.issues) {
    const location = locateQuote(issue.original, segments, issue.segmentId, flat);
    if (location) issues.push({ ...issue, segmentId: location.segmentId, startMs: location.startMs });
  }

  const exercises: SpeakingAssessment['exercises'] = [];
  for (const exercise of model.exercises) {
    const location = locateQuote(exercise.sourceQuote, segments, exercise.sourceSegmentId, flat);
    if (location) {
      exercises.push({
        ...exercise,
        id: `e${exercises.length + 1}`,
        sourceSegmentId: location.segmentId,
        startMs: location.startMs,
      });
    }
  }

  // Patterns are summaries; keep them when they still point at real segments.
  const recurringPatterns = model.recurringPatterns
    .map((pattern) => ({ ...pattern, segmentIds: pattern.segmentIds.filter((id) => knownIds.has(id)) }))
    .filter((pattern) => pattern.segmentIds.length > 0);

  return {
    ...model,
    issues,
    exercises,
    recurringPatterns,
    discarded: { issues: model.issues.length - issues.length, exercises: model.exercises.length - exercises.length },
  };
}
