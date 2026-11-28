import type { LoaderFunctionArgs } from 'react-router';

/*
 * The blog is a separate Next.js site (the `zes-ai` project) that is served
 * from its own domain. This route turns `/blog` on this app into a shortcut to
 * it, so the header link keeps working even when the domain changes.
 */
const BLOG_URL = 'https://blog.zes.codes/blog';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const target = new URL(BLOG_URL);
  const suffix = url.pathname.replace(/^\/blog\/?/, '');

  if (suffix) {
    target.pathname = `${target.pathname}/${suffix}`;
  }

  target.search = url.search;

  return Response.redirect(target.toString(), 302);
};
