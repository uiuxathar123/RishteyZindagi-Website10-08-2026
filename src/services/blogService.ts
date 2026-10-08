import { BLOG_POSTS, BlogPost } from "@/data/blogPosts";

/**
 * blogService — CRUD-lite over blog/journal articles.
 * Static marketing content (the backend has no blog/CMS API); every function is async so a later
 * CMS/API swap is a one-line change per function, not a component rewrite.
 */
export const blogService = {
  async list(): Promise<BlogPost[]> {
    return [...BLOG_POSTS].sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1));
  },

  async getBySlug(slug: string): Promise<BlogPost | undefined> {
    return BLOG_POSTS.find((p) => p.slug === slug);
  },

  async related(slug: string, limit = 3): Promise<BlogPost[]> {
    return BLOG_POSTS.filter((p) => p.slug !== slug).slice(0, limit);
  },
};
