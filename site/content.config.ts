import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const skills = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './site/content/skills' }),
  schema: z.object({
    tagline: z.string(),
  }),
});

const tutorials = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './site/content/tutorials' }),
  schema: z.object({
    title: z.string(),
    tagline: z.string(),
    order: z.number(),
    description: z.string(),
  }),
});

const reference = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './site/content/reference' }),
  schema: z.object({
    title: z.string(),
    tagline: z.string(),
    description: z.string(),
    section: z.enum(['concepts', 'automation', 'reference']),
    order: z.number(),
  }),
});

export const collections = { skills, tutorials, reference };
