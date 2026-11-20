import type { SpeakingCategory, SpeakingLevel, SpeakingPrompt, TargetDurationSeconds } from '@ldg/shared';

/**
 * A small, curated set of speaking tasks: two per category, one at B2 and one
 * at C1. B2 tasks ask for a clear, supported opinion; C1 tasks ask the learner
 * to weigh competing views, qualify claims and speculate. Guided mode adds a
 * suggested structure; the discussion points are shown in both modes.
 */
export interface LibraryPrompt {
  readonly id: string;
  readonly title: string;
  readonly instructions: string;
  readonly points: readonly string[];
  readonly category: SpeakingCategory;
  readonly level: SpeakingLevel;
  readonly suggestedDurationSeconds: TargetDurationSeconds;
  /** Guided mode only: how to organise the answer. */
  readonly structure: readonly string[];
}

export const CATEGORY_LABELS: Readonly<Record<SpeakingCategory, string>> = {
  technology: 'Technology',
  work: 'Work',
  culture: 'Culture',
  education: 'Education',
  science: 'Science',
  society: 'Society',
  everyday: 'Everyday situations',
};

export const PROMPT_LIBRARY: readonly LibraryPrompt[] = [
  {
    id: 'technology-phones-at-school',
    title: 'Smartphones in schools',
    instructions: 'Should smartphones be banned in secondary schools? Give your opinion and explain why.',
    points: ['Effects on concentration and learning', 'Safety and contact with parents', 'Teaching students to use technology responsibly'],
    category: 'technology',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['State your opinion clearly', 'Give two reasons, each with an example', 'Mention one argument on the other side', 'Finish with a short conclusion'],
  },
  {
    id: 'technology-ai-creativity',
    title: 'AI and human creativity',
    instructions:
      'Some people argue that generative AI will devalue human creativity; others see it as a new creative tool. Discuss both views and say where you stand.',
    points: ['What counts as "original" work', 'Effects on artists’ and writers’ livelihoods', 'How AI might change creative education'],
    category: 'technology',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: [
      'Frame the debate in one or two sentences',
      'Present the strongest case for each side',
      'Weigh them: which concerns are justified, which overstated?',
      'Give a nuanced conclusion with a condition or caveat',
    ],
  },
  {
    id: 'work-remote-or-office',
    title: 'Remote or office work?',
    instructions: 'Would you rather work from home or in an office? Explain your choice with reasons and examples.',
    points: ['Productivity and focus', 'Relationships with colleagues', 'Work-life balance'],
    category: 'work',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['Say which you prefer', 'Explain your main reason with a personal example', 'Admit one disadvantage of your choice', 'Conclude'],
  },
  {
    id: 'work-four-day-week',
    title: 'The four-day working week',
    instructions:
      'Several countries have trialled a four-day working week with no loss of pay. Evaluate whether it could work across the whole economy, not just in office jobs.',
    points: ['Evidence from trials and its limits', 'Sectors where it is harder (healthcare, retail)', 'Effects on productivity, wellbeing and costs'],
    category: 'work',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: ['Summarise the idea and why it is popular', 'Analyse where it works and where it struggles', 'Consider who pays the costs', 'Reach a qualified judgement'],
  },
  {
    id: 'culture-tourism',
    title: 'Mass tourism',
    instructions: 'Is mass tourism good or bad for popular cities? Give your view with examples.',
    points: ['The local economy and jobs', 'Housing and everyday life for residents', 'Protecting historic places'],
    category: 'culture',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['Give your overall view', 'Describe one benefit and one problem', 'Suggest one solution', 'Conclude'],
  },
  {
    id: 'culture-preserving-languages',
    title: 'Should minority languages be protected?',
    instructions:
      'Governments often spend public money on protecting minority languages. Discuss whether this is a good use of resources and what it achieves.',
    points: ['Cultural identity and heritage', 'Practical value in a globalised world', 'Who should decide, and who should pay'],
    category: 'culture',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: ['Explain what is at stake', 'Contrast the cultural and the economic arguments', 'Discuss an example you know', 'Conclude with your position and its limits'],
  },
  {
    id: 'education-online-learning',
    title: 'Learning online',
    instructions: 'Is it possible to learn as well online as in a classroom? Explain your opinion using your own experience.',
    points: ['Motivation and discipline', 'Interaction with teachers and classmates', 'Flexibility and cost'],
    category: 'education',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['Answer the question directly', 'Describe a personal experience', 'Compare one strength and one weakness', 'Conclude'],
  },
  {
    id: 'education-university-for-all',
    title: 'University for everyone?',
    instructions:
      'Should governments aim to send as many young people as possible to university? Assess the benefits and drawbacks for individuals and for society.',
    points: ['Graduate debt and job prospects', 'Vocational and technical alternatives', 'Social mobility and fairness'],
    category: 'education',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: ['Clarify the question', 'Discuss individual benefits and costs', 'Discuss effects on society and the economy', 'Propose a balanced policy'],
  },
  {
    id: 'science-space-exploration',
    title: 'Is space exploration worth the money?',
    instructions: 'Some people think money spent on space exploration should be spent on problems on Earth. What do you think?',
    points: ['Scientific and technological benefits', 'Urgent problems on Earth', 'Private companies in space'],
    category: 'science',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['Give your opinion', 'Support it with two reasons', 'Respond to the opposite view', 'Conclude'],
  },
  {
    id: 'science-trust-in-experts',
    title: 'Trust in scientific experts',
    instructions:
      'Public trust in scientific experts seems to have fallen in many countries. Why might this be, and what, if anything, can scientists do about it?',
    points: ['The role of social media', 'Uncertainty and changing advice', 'Communication and transparency'],
    category: 'science',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: ['Explain the trend and possible causes', 'Analyse one cause in depth', 'Evaluate possible responses', 'Conclude with a realistic recommendation'],
  },
  {
    id: 'society-volunteering',
    title: 'Compulsory community service',
    instructions: 'Should young people have to do a year of community service after school? Give your opinion and reasons.',
    points: ['Skills and experience', 'Personal freedom', 'Benefits for the community'],
    category: 'society',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['State your position', 'Give your strongest reason with an example', 'Consider one objection', 'Conclude'],
  },
  {
    id: 'society-surveillance',
    title: 'Security and privacy in public spaces',
    instructions:
      'Facial recognition cameras could make cities safer but also enable mass surveillance. Discuss where the line between security and privacy should be drawn.',
    points: ['Effectiveness against crime', 'Risk of misuse and errors', 'Safeguards: law, oversight, consent'],
    category: 'society',
    level: 'C1',
    suggestedDurationSeconds: 180,
    structure: [
      'Set out the tension between the two values',
      'Assess the benefits realistically',
      'Analyse the risks, with an example',
      'Propose conditions under which it could be acceptable',
    ],
  },
  {
    id: 'everyday-complaint',
    title: 'Making a complaint',
    instructions:
      'You bought a laptop online and it arrived damaged. Explain the problem to customer service on the phone and say what you would like them to do.',
    points: ['What happened and when', 'What you have already tried', 'What solution you expect'],
    category: 'everyday',
    level: 'B2',
    suggestedDurationSeconds: 60,
    structure: ['Greet and say why you are calling', 'Describe the problem precisely', 'Ask politely but firmly for a solution', 'Confirm the next steps'],
  },
  {
    id: 'everyday-difficult-conversation',
    title: 'A difficult conversation with a neighbour',
    instructions:
      'Your neighbour regularly plays loud music late at night. Explain how you would raise the issue with them diplomatically, and what you would say.',
    points: ['Choosing the right moment and tone', 'Explaining the impact without blaming', 'Finding a compromise'],
    category: 'everyday',
    level: 'C1',
    suggestedDurationSeconds: 120,
    structure: ['Describe the situation briefly', 'Explain your approach and why', 'Give the actual words you would use', 'Say how you would handle a defensive reaction'],
  },
];

export function findLibraryPrompt(id: string): LibraryPrompt | undefined {
  return PROMPT_LIBRARY.find((prompt) => prompt.id === id);
}

/** The prompt as it is stored with an attempt and sent for assessment. */
export function toSpeakingPrompt(prompt: LibraryPrompt): SpeakingPrompt {
  return {
    source: 'library',
    promptId: prompt.id,
    title: prompt.title,
    instructions: prompt.instructions,
    points: [...prompt.points],
    category: prompt.category,
    level: prompt.level,
  };
}
