// Path: archon-cli/src/commands/knowledge.ts
// Knowledge base management commands

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { format } from 'date-fns';
import { getActiveProfile, getActiveProfileName } from '../config/index.js';
import { getValidToken } from '../config/tokens.js';
import { createApiClient } from '../api/client.js';
import { KnowledgeDocument } from '../api/types.js';
import { output, success, error, TableConfig } from '../output/index.js';
import { handleError } from '../utils/errors.js';
import { withSpinner } from '../utils/spinner.js';

interface KnowledgeListItem {
  slug: string;
  title: string;
  category: string;
  isGlobal: string;
  updatedAt: string;
}

const knowledgeTableConfig: TableConfig<KnowledgeListItem[]> = {
  headers: ['Slug', 'Title', 'Category', 'Global', 'Updated'],
  transform: (docs) =>
    docs.map(d => [
      d.slug,
      d.title.substring(0, 40),
      d.category,
      d.isGlobal,
      d.updatedAt
    ])
};

export function registerKnowledgeCommands(program: Command): void {
  const knowledge = program
    .command('knowledge')
    .alias('kb')
    .description('Knowledge base management');

  // List documents
  knowledge
    .command('list')
    .description('List knowledge base documents')
    .option('-c, --category <category>', 'Filter by category')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        const docs = await withSpinner<KnowledgeDocument[]>(
          'Fetching documents...',
          async () => api.get<KnowledgeDocument[]>('/api/knowledge')
        );

        let filtered = docs;
        if (options.category) {
          filtered = filtered.filter(d =>
            d.category.toLowerCase().includes(options.category.toLowerCase())
          );
        }

        const items: KnowledgeListItem[] = filtered.map(d => ({
          slug: d.slug,
          title: d.title,
          category: d.category,
          isGlobal: d.isGlobal ? chalk.green('Yes') : '-',
          updatedAt: d.updatedAt
            ? format(new Date(d.updatedAt), 'yyyy-MM-dd')
            : format(new Date(d.createdAt), 'yyyy-MM-dd')
        }));

        output(items, knowledgeTableConfig);
        console.log(chalk.gray(`\n${items.length} document(s)`));
      } catch (err) {
        handleError(err);
      }
    });

  // Get document
  knowledge
    .command('get <slug>')
    .description('Get a knowledge base document')
    .option('-r, --raw', 'Show raw markdown content')
    .action(async (slug, options) => {
      try {
        const api = await getAuthenticatedClient();

        const doc = await withSpinner<KnowledgeDocument>(
          'Fetching document...',
          async () => api.get<KnowledgeDocument>(`/api/knowledge/${slug}`)
        );

        if (options.raw) {
          console.log(doc.content);
        } else {
          console.log();
          console.log(chalk.bold(doc.title));
          console.log(chalk.gray(`Category: ${doc.category}`));
          if (doc.tags.length > 0) {
            console.log(chalk.gray(`Tags: ${doc.tags.join(', ')}`));
          }
          console.log();
          console.log(doc.content);
          console.log();
        }
      } catch (err) {
        handleError(err);
      }
    });

  // Create document
  knowledge
    .command('create')
    .description('Create a knowledge base document')
    .option('-s, --slug <slug>', 'Document slug')
    .option('-t, --title <title>', 'Document title')
    .option('-c, --category <category>', 'Category')
    .option('-g, --global', 'Mark as global document')
    .action(async (options) => {
      try {
        const api = await getAuthenticatedClient();

        let slug = options.slug;
        let title = options.title;
        let category = options.category;
        let isGlobal = options.global || false;

        if (!slug || !title || !category) {
          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'title',
              message: 'Document title:',
              when: !title,
              validate: (input: string) => input.length > 0 || 'Title is required'
            },
            {
              type: 'input',
              name: 'slug',
              message: 'Document slug:',
              when: !slug,
              default: (answers: { title?: string }) =>
                (answers.title || title || '').toLowerCase().replace(/\s+/g, '-'),
              validate: (input: string) => /^[a-z0-9-]+$/.test(input) || 'Slug must be lowercase alphanumeric with dashes'
            },
            {
              type: 'input',
              name: 'category',
              message: 'Category:',
              when: !category,
              default: 'General'
            },
            {
              type: 'confirm',
              name: 'isGlobal',
              message: 'Mark as global document?',
              default: false,
              when: !options.global
            }
          ]);

          slug = slug || answers.slug;
          title = title || answers.title;
          category = category || answers.category;
          isGlobal = options.global || answers.isGlobal;
        }

        // Open editor for content
        const { content } = await inquirer.prompt([
          {
            type: 'editor',
            name: 'content',
            message: 'Document content (opens editor):'
          }
        ]);

        const doc = await withSpinner<KnowledgeDocument>(
          'Creating document...',
          async () => api.post<KnowledgeDocument>('/api/knowledge', {
            slug,
            title,
            content,
            category,
            isGlobal,
            tags: []
          }),
          'Document created'
        );

        output({
          slug: doc.slug,
          title: doc.title,
          category: doc.category
        });
      } catch (err) {
        handleError(err);
      }
    });

  // Update document
  knowledge
    .command('update <slug>')
    .description('Update a knowledge base document')
    .option('-t, --title <title>', 'New title')
    .option('-c, --category <category>', 'New category')
    .option('-e, --edit', 'Edit content in editor')
    .action(async (slug, options) => {
      try {
        const api = await getAuthenticatedClient();

        // Get existing document
        const existing = await api.get<KnowledgeDocument>(`/api/knowledge/${slug}`);

        const updateData: Record<string, unknown> = {};

        if (options.title) updateData.title = options.title;
        if (options.category) updateData.category = options.category;

        if (options.edit) {
          const { content } = await inquirer.prompt([
            {
              type: 'editor',
              name: 'content',
              message: 'Edit document content:',
              default: existing.content
            }
          ]);
          updateData.content = content;
        }

        if (Object.keys(updateData).length === 0) {
          error('No update options provided. Use --title, --category, or --edit.');
          process.exit(1);
        }

        await withSpinner(
          'Updating document...',
          async () => api.patch(`/api/knowledge/${slug}`, updateData),
          'Document updated'
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Delete document
  knowledge
    .command('delete <slug>')
    .description('Delete a knowledge base document')
    .option('-f, --force', 'Skip confirmation')
    .action(async (slug, options) => {
      try {
        const api = await getAuthenticatedClient();

        const doc = await api.get<KnowledgeDocument>(`/api/knowledge/${slug}`);

        if (!options.force) {
          const { confirm } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'confirm',
              message: `Delete document '${doc.title}'?`,
              default: false
            }
          ]);

          if (!confirm) {
            console.log('Cancelled.');
            return;
          }
        }

        await withSpinner(
          'Deleting document...',
          async () => api.delete(`/api/knowledge/${slug}`),
          `Document '${doc.title}' deleted`
        );
      } catch (err) {
        handleError(err);
      }
    });

  // Search documents
  knowledge
    .command('search <query>')
    .description('Search knowledge base')
    .action(async (query) => {
      try {
        const api = await getAuthenticatedClient();

        const results = await withSpinner<KnowledgeDocument[]>(
          'Searching...',
          async () => api.get<KnowledgeDocument[]>(`/api/knowledge/search?q=${encodeURIComponent(query)}`)
        );

        if (results.length === 0) {
          console.log(chalk.gray('No results found.'));
          return;
        }

        console.log();
        console.log(chalk.bold(`Found ${results.length} result(s)`));
        console.log();

        for (const doc of results) {
          console.log(chalk.cyan(doc.title));
          console.log(chalk.gray(`  /${doc.slug} | ${doc.category}`));
          // Show content snippet
          const snippet = doc.content.substring(0, 150).replace(/\n/g, ' ');
          console.log(chalk.gray(`  ${snippet}...`));
          console.log();
        }
      } catch (err) {
        handleError(err);
      }
    });

  // List categories
  knowledge
    .command('categories')
    .description('List all categories')
    .action(async () => {
      try {
        const api = await getAuthenticatedClient();

        const docs = await api.get<KnowledgeDocument[]>('/api/knowledge');

        const categories = new Map<string, number>();
        for (const doc of docs) {
          categories.set(doc.category, (categories.get(doc.category) || 0) + 1);
        }

        console.log();
        console.log(chalk.bold('Categories'));
        for (const [category, count] of categories.entries()) {
          console.log(`  ${category}: ${count} document(s)`);
        }
        console.log();
      } catch (err) {
        handleError(err);
      }
    });
}

async function getAuthenticatedClient() {
  const profileName = getActiveProfileName();
  const profile = getActiveProfile();

  const token = await getValidToken(profileName, profile.url);
  if (!token) {
    error('Not authenticated. Run: archon auth login');
    process.exit(1);
  }

  return createApiClient(profile.url, token);
}
